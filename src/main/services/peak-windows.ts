import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { peakWindows, distributeContainers, type PeakWindow, type DistributionPlan } from '@shared/peak-windows'
import type { Ctx } from '../context'
import { jobs, publicationContainers as containers, publicationContainerItems as items } from '../db/schema'
import { getSetting, setSetting } from '../repos/settings'
import { getWorkspace } from '../repos/workspaces'
import { requireWorkspace } from './integrations'
import { readQuotaSnapshot, quotaLedger } from './instagram-quota'

const KEY = 'scheduler.peakWindows'
/** The existing scheduling limit: every publication within 90 days. */
export const DISTRIBUTION_HORIZON_DAYS = 90

export function readPeakWindows(ctx: Ctx, ws: string): { windows: PeakWindow[]; timeZone: string } {
  requireWorkspace(ctx, ws)
  const raw = getSetting(ctx.db, ws, KEY)
  let windows: PeakWindow[] = []
  try { const parsed = peakWindows.safeParse(raw ? JSON.parse(raw) : []); if (parsed.success) windows = parsed.data } catch { /* corrupt setting: no windows rather than invented ones */ }
  return { windows, timeZone: getWorkspace(ctx.db, ws)!.timeZone }
}
export function savePeakWindows(ctx: Ctx, ws: string, input: unknown) {
  requireWorkspace(ctx, ws)
  const parsed = peakWindows.safeParse(input)
  if (!parsed.success) throw new AppError('invalid_input', parsed.error.issues[0].message)
  setSetting(ctx.db, ws, KEY, JSON.stringify(parsed.data))
  return readPeakWindows(ctx, ws)
}


function selection(ctx: Ctx, ws: string, ids: string[]) {
  const rows = ctx.db.select().from(containers).where(and(eq(containers.workspaceId, ws), inArray(containers.id, ids))).all()
  if (rows.length !== new Set(ids).size || rows.length !== ids.length) throw new AppError('not_found', 'Container não encontrado neste workspace.')
  const ordered = ids.map(id => rows.find(r => r.id === id)!)
  if (ordered.some(r => r.scheduledAt || r.controlState !== 'active')) throw new AppError('invalid_input', 'Somente rascunhos ativos podem ser distribuídos. Containers agendados não são movidos.')
  const account = ordered[0].destinationAccountId
  if (!account || ordered.some(r => r.destinationAccountId !== account || r.provider !== 'instagram')) throw new AppError('invalid_input', 'Distribua Containers de um mesmo destino por vez; defina o destino de cada rascunho.')
  const counts = new Map(ctx.db.select({ id: items.containerId, n: sql<number>`count(*)` }).from(items)
    .where(and(eq(items.workspaceId, ws), inArray(items.containerId, ids))).groupBy(items.containerId).all().map(r => [r.id, r.n]))
  if (ordered.some(r => !counts.get(r.id))) throw new AppError('invalid_input', 'Cada Container precisa de pelo menos um vídeo.')
  return { account, ordered: ordered.map(r => ({ row: r, count: counts.get(r.id)! })) }
}

/**
 * What the account already occupies: each scheduled Container as one span of its pending jobs (no interleaving),
 * legacy or ambiguous jobs as points, and other positioned drafts of the same account. Only jobs are quota
 * reservations; drafts just keep two distributions from stacking on the same time.
 */
export function occupied(ctx: Ctx, ws: string, account: string, exclude: string[], excludeContainer?: string) {
  const pending = ctx.db.select({ runAt: jobs.runAt, updatedAt: jobs.updatedAt, container: sql<string | null>`json_extract(${jobs.payloadJson}, '$.publicationContainerId')` }).from(jobs)
    .where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'publish_instagram'), inArray(jobs.state, ['queued', 'running']), sql`json_extract(${jobs.payloadJson}, '$.accountId') = ${account}`)).all()
  const spans = new Map<string, [number, number]>(), points: [number, number][] = []
  for (const j of pending) {
    const t = Date.parse(j.runAt)
    if (excludeContainer && j.container === excludeContainer) continue
    if (!j.container) { points.push([t, t]); continue }
    const span = spans.get(j.container)
    spans.set(j.container, span ? [Math.min(span[0], t), Math.max(span[1], t)] : [t, t])
  }
  const drafts = ctx.db.select({ start: containers.plannedStartAt, end: containers.plannedEndAt }).from(containers)
    .where(and(eq(containers.workspaceId, ws), eq(containers.destinationAccountId, account), isNull(containers.scheduledAt), eq(containers.controlState, 'active'),
      isNotNull(containers.plannedStartAt), exclude.length ? notInArray(containers.id, exclude) : undefined)).all()
  return [...spans.values(), ...points, ...drafts.map(d => [Date.parse(d.start!), Date.parse(d.end ?? d.start!)] as [number, number])]
    .map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() }))
}

export function planDistribution(ctx: Ctx, ws: string, input: { containerIds: string[]; fromDate: string }): DistributionPlan {
  requireWorkspace(ctx, ws)
  const { account, ordered } = selection(ctx, ws, input.containerIds)
  const { windows, timeZone } = readPeakWindows(ctx, ws)
  if (!windows.length) throw new AppError('invalid_input', 'Configure as janelas de pico em Configurações antes de distribuir.')
  const now = ctx.clock(), snapshot = readQuotaSnapshot(ctx.db, ws, account, now)
  const since = snapshot?.fetchedAt && snapshot.durationSec ? new Date(Date.parse(snapshot.fetchedAt) - snapshot.durationSec * 1000).toISOString() : null
  const ledger = quotaLedger(ctx.db, ws, account, since)
  const result = distributeContainers({
    containers: ordered.map(c => ({ id: c.row.id, count: c.count, intervalMin: c.row.intervalMin })),
    windows, timeZone, fromDate: input.fromDate, now: now.toISOString(), horizonDays: DISTRIBUTION_HORIZON_DAYS,
    reserved: occupied(ctx, ws, account, input.containerIds),
    quota: { snapshot, confirmed: ledger.confirmed, uncertain: ledger.uncertain, pending: ledger.pending }
  })
  return { accountId: account, timeZone, fromDate: input.fromDate, windows, quota: result.quota, peakInWindow: result.peakInWindow,
    placements: result.placements.map((p, i) => ({ ...p, name: ordered[i].row.name, count: ordered[i].count, intervalMin: ordered[i].row.intervalMin, revision: ordered[i].row.revision })) }
}

/**
 * Applies a reviewed plan to drafts only, all or nothing. The plan is recomputed inside the transaction;
 * if anything changed since the preview (another schedule, draft or quota reading), nothing is written.
 * Scheduling stays a separate step with the PR 05 quota check.
 */
export function applyDistribution(ctx: Ctx, ws: string, input: { fromDate: string; items: { containerId: string; expectedRevision: number; start: string }[] }) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => {
    const plan = planDistribution(ctx, ws, { containerIds: input.items.map(i => i.containerId), fromDate: input.fromDate })
    for (const [i, item] of input.items.entries()) {
      const p = plan.placements[i]
      if (p.revision !== item.expectedRevision) throw new AppError('invalid_input', 'Um Container mudou desde a prévia. Revise a distribuição novamente.')
      if (!p.placed || Date.parse(p.start) !== Date.parse(item.start)) throw new AppError('invalid_input', 'A distribuição mudou desde a prévia. Revise os horários novamente.')
    }
    const now = ctx.clock().toISOString()
    for (const p of plan.placements) {
      if (!p.placed) continue
      ctx.db.update(containers).set({ plannedStartAt: p.start, plannedEndAt: p.end, timeZone: plan.timeZone, revision: p.revision + 1, updatedAt: now })
        .where(and(eq(containers.workspaceId, ws), eq(containers.id, p.id), eq(containers.revision, p.revision))).run()
    }
    return planDistribution(ctx, ws, { containerIds: input.items.map(i => i.containerId), fromDate: input.fromDate })
  }, { behavior: 'immediate' })
}

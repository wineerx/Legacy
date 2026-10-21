import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { remoteStarted } from '@shared/publication-containers'
import { estimateWindow, proposeAdjustments, type AdjustmentState, type ContainerWindowView, type WindowInput } from '@shared/container-window'
import type { PublicationContainer } from '@shared/publication-containers'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { jobs, publicationContainerAdjustments as adjustments, publicationContainerItems as items, publicationContainers as containers, publicationHistory } from '../db/schema'
import { containerRow, containerScope } from '../repos/publication-containers'
import { requireWorkspace } from './integrations'
import { readQuotaSnapshot, quotaLedger, assertScheduleQuota } from './instagram-quota'
import { readPeakWindows, occupied, DISTRIBUTION_HORIZON_DAYS } from './peak-windows'
import { previewDrag, type DragPreview } from '@shared/container-drag'


function windowInput(ctx: Ctx, ws: string, id: string) {
  const row = containerRow(ctx.db, ws, id)
  const rows = ctx.db.select({ jobId: jobs.id, position: items.position, state: jobs.state, runAt: jobs.runAt, resultJson: jobs.resultJson, confirmed: publicationHistory.jobId })
    .from(items).innerJoin(jobs, and(eq(jobs.workspaceId, items.workspaceId), eq(jobs.id, items.jobId)))
    .leftJoin(publicationHistory, and(eq(publicationHistory.workspaceId, items.workspaceId), eq(publicationHistory.jobId, items.jobId)))
    .where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).orderBy(asc(items.position)).all()
  const now = ctx.clock()
  const account = row.destinationAccountId
  const snapshot = account ? readQuotaSnapshot(ctx.db, ws, account, now) : null
  const since = snapshot?.fetchedAt && snapshot.durationSec ? new Date(Date.parse(snapshot.fetchedAt) - snapshot.durationSec * 1000).toISOString() : null
  const own = new Set(rows.map(r => r.jobId))
  const ledger = account ? quotaLedger(ctx.db, ws, account, since) : { confirmed: [], uncertain: [], pending: [] }
  const input: WindowInput = {
    plannedStartAt: row.plannedStartAt, plannedEndAt: row.plannedEndAt, intervalMin: row.intervalMin, control: row.controlState, scheduled: Boolean(row.scheduledAt),
    now: now.toISOString(),
    items: rows.map(r => { let cp = {}; try { cp = JSON.parse(r.resultJson ?? '{}') } catch { /* unreadable: not started */ } return { jobId: r.jobId, position: r.position, state: r.state, confirmed: Boolean(r.confirmed), runAt: r.runAt, remote: remoteStarted(cp) } }),
    quota: { snapshot, confirmed: ledger.confirmed, uncertain: ledger.uncertain, others: ledger.pending.filter(p => !own.has(p.jobId)) }
  }
  return { row, input, snapshot }
}

export function readContainerWindow(ctx: Ctx, ws: string, id: string): ContainerWindowView {
  requireWorkspace(ctx, ws)
  const { row, input, snapshot } = windowInput(ctx, ws, id)
  const window = estimateWindow(input)
  const peak = readPeakWindows(ctx, ws)
  const fromDate = new Intl.DateTimeFormat('en-CA', { timeZone: peak.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ctx.clock())
  const proposals = row.destinationAccountId && row.controlState === 'active'
    ? proposeAdjustments(input, window, { windows: peak.windows, timeZone: peak.timeZone, fromDate, horizonDays: DISTRIBUTION_HORIZON_DAYS, reserved: occupied(ctx, ws, row.destinationAccountId, [], id) })
    : { proposals: [], unavailable: [] }
  const fresh = snapshot?.freshness === 'fresh'
  const history = ctx.db.select().from(adjustments).where(and(eq(adjustments.workspaceId, ws), eq(adjustments.containerId, id))).orderBy(desc(adjustments.createdAt)).limit(20).all()
  return { containerId: id, revision: row.revision, timeZone: row.timeZone, window, proposals,
    quota: { total: fresh ? snapshot!.total : null, available: fresh ? Math.max(0, snapshot!.total! - snapshot!.usage!) : null, fetchedAt: snapshot?.fetchedAt ?? null, freshness: snapshot?.freshness ?? 'missing' },
    adjustments: history.map(a => ({ id: a.id, kind: a.kind, createdAt: a.createdAt, before: JSON.parse(a.beforeJson), after: JSON.parse(a.afterJson) })) }
}

/**
 * Applies the adjustment the user chose, all or nothing. The proposal is recomputed inside the IMMEDIATE
 * transaction and must still match what was shown; only fresh items (no remote checkpoint) move; the
 * account quota is re-checked (PR 05); the change is recorded with the plan before and after.
 */
export function applyContainerAdjustment(ctx: Ctx, ws: string, id: string, input: { expectedRevision: number; kind: 'keep' | 'reduce' | 'move'; slots: { jobId: string; at: string }[] }) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => {
    const view = readContainerWindow(ctx, ws, id)
    const row = containerRow(ctx.db, ws, id)
    if (row.revision !== input.expectedRevision) throw new AppError('invalid_input', 'O Container mudou. Revise a janela novamente.')
    if (!row.scheduledAt || row.controlState !== 'active') throw new AppError('invalid_input', 'Ajustes valem apenas para Containers agendados e ativos.')
    const proposal = view.proposals.proposals.find(p => p.kind === input.kind)
    if (!proposal) throw new AppError('invalid_input', 'Esta opção não está mais disponível. Revise a janela novamente.')
    const slots = proposal.kind === 'keep' ? [] : proposal.slots
    if (slots.length !== input.slots.length || slots.some((s, i) => s.jobId !== input.slots[i].jobId || Date.parse(s.at) !== Date.parse(input.slots[i].at)))
      throw new AppError('invalid_input', 'Os horários mudaram desde a prévia. Revise a janela novamente.')
    const now = ctx.clock().toISOString()
    if (slots.length) {
      const current = ctx.db.select({ id: jobs.id, state: jobs.state, runAt: jobs.runAt, resultJson: jobs.resultJson }).from(jobs).where(and(eq(jobs.workspaceId, ws), inArray(jobs.id, slots.map(s => s.jobId)))).all()
      for (const s of slots) {
        const job = current.find(j => j.id === s.jobId)
        if (!job || job.state !== 'queued' || remoteStarted(JSON.parse(job.resultJson ?? '{}'))) throw new AppError('invalid_input', 'Um vídeo já começou a ser enviado. Revise a janela novamente.')
        ctx.db.update(jobs).set({ runAt: s.at, updatedAt: now }).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, s.jobId), eq(jobs.state, 'queued'))).run()
        ctx.db.update(items).set({ plannedPublishAt: s.at, updatedAt: now }).where(and(eq(items.workspaceId, ws), eq(items.jobId, s.jobId))).run()
      }
      const all = ctx.db.select({ id: items.jobId }).from(items).where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).all().flatMap(r => r.id ? [r.id] : [])
      assertScheduleQuota(ctx, ws, row.destinationAccountId!, all, row.timeZone)
    }
    const before: AdjustmentState = { intervalMin: row.intervalMin, plannedEndAt: row.plannedEndAt, delayMin: view.window.delayMin,
      ...(slots.length ? { slots: slots.map(s => ({ jobId: s.jobId, at: view.window.estimate.find(e => e.jobId === s.jobId)?.at ?? s.at })) } : {}) }
    const intervalMin = proposal.kind === 'reduce' ? proposal.intervalMin : row.intervalMin
    const plannedEndAt = proposal.kind === 'move' && row.plannedEndAt && Date.parse(proposal.estimatedEndAt) > Date.parse(row.plannedEndAt) ? proposal.estimatedEndAt : row.plannedEndAt
    const after: AdjustmentState = { intervalMin, plannedEndAt, delayMin: 'delayMin' in proposal ? proposal.delayMin : 0, ...(slots.length ? { slots } : {}) }
    ctx.db.update(containers).set({ intervalMin, plannedEndAt, revision: row.revision + 1, updatedAt: now }).where(containerScope(ws, id)).run()
    ctx.db.insert(adjustments).values({ id: newId(), workspaceId: ws, containerId: id, kind: input.kind, beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after), createdAt: now }).run()
    return readContainerWindow(ctx, ws, id)
  }, { behavior: 'immediate' })
}

/** Fills the estimate fields reserved since PR 01; cheap: no proposals are computed. */
export function withEstimate(ctx: Ctx, ws: string, c: PublicationContainer): PublicationContainer {
  if (!c.scheduledAt) return c
  const { input, snapshot } = windowInput(ctx, ws, c.id)
  const w = estimateWindow(input), fresh = snapshot?.freshness === 'fresh'
  return { ...c, estimatedEndAt: w.estimatedEndAt, delayMin: w.delayMin, quotaTotal: fresh ? snapshot!.total : null, quotaAvailable: fresh ? Math.max(0, snapshot!.total! - snapshot!.usage!) : null }
}

function dragInput(ctx: Ctx, ws: string, id: string, startAt: string) {
  const { row, input } = windowInput(ctx, ws, id)
  const planned = Object.fromEntries(ctx.db.select({ jobId: items.jobId, at: items.plannedPublishAt }).from(items)
    .where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).all().flatMap(r => r.jobId ? [[r.jobId, r.at]] : []))
  const reserved = row.destinationAccountId ? occupied(ctx, ws, row.destinationAccountId, [id], id) : []
  return { row, input, preview: previewDrag({ window: input, planned, targetStartAt: startAt, reserved, peak: readPeakWindows(ctx, ws) }) }
}

/** Impact of dropping a Container at a new start (PR 10). Read-only: nothing changes until the user confirms. */
export function previewContainerDrag(ctx: Ctx, ws: string, id: string, startAt: string): DragPreview & { revision: number } {
  requireWorkspace(ctx, ws)
  const { row, preview } = dragInput(ctx, ws, id, startAt)
  return { ...preview, revision: row.revision }
}

/**
 * Applies a confirmed drop, all or nothing, with the same guarantees as the PR 07 adjustments: the preview
 * is recomputed inside an IMMEDIATE transaction and must match what was shown; only fresh items move; the
 * account quota is re-checked; the planned window shifts and the change is recorded with before and after.
 */
export function applyContainerDrag(ctx: Ctx, ws: string, id: string, input: { expectedRevision: number; startAt: string; slots: { jobId: string; at: string }[] }) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => {
    const { row, input: windowState, preview } = dragInput(ctx, ws, id, input.startAt)
    if (row.revision !== input.expectedRevision) throw new AppError('invalid_input', 'O Container mudou. Arraste novamente para revisar o impacto.')
    if (preview.blocked) throw new AppError('invalid_input', preview.blocked)
    if (preview.slots.length !== input.slots.length || preview.slots.some((s, i) => s.jobId !== input.slots[i].jobId || Date.parse(s.at) !== Date.parse(input.slots[i].at)))
      throw new AppError('invalid_input', 'Os horários mudaram desde a prévia. Arraste novamente para revisar o impacto.')
    const now = ctx.clock().toISOString()
    const current = ctx.db.select({ id: jobs.id, state: jobs.state, resultJson: jobs.resultJson }).from(jobs).where(and(eq(jobs.workspaceId, ws), inArray(jobs.id, preview.slots.map(s => s.jobId)))).all()
    for (const s of preview.slots) {
      const job = current.find(j => j.id === s.jobId)
      if (!job || job.state !== 'queued' || remoteStarted(JSON.parse(job.resultJson ?? '{}'))) throw new AppError('invalid_input', 'Um vídeo já começou a ser enviado. Arraste novamente para revisar o impacto.')
      ctx.db.update(jobs).set({ runAt: s.at, updatedAt: now }).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, s.jobId), eq(jobs.state, 'queued'))).run()
      ctx.db.update(items).set({ plannedPublishAt: s.at, updatedAt: now }).where(and(eq(items.workspaceId, ws), eq(items.jobId, s.jobId))).run()
    }
    const all = ctx.db.select({ id: items.jobId }).from(items).where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).all().flatMap(r => r.id ? [r.id] : [])
    assertScheduleQuota(ctx, ws, row.destinationAccountId!, all, row.timeZone)
    const before: AdjustmentState = { intervalMin: row.intervalMin, plannedStartAt: row.plannedStartAt, plannedEndAt: row.plannedEndAt, delayMin: estimateWindow(windowState).delayMin, slots: preview.slots.map(s => ({ jobId: s.jobId, at: s.before })) }
    const after: AdjustmentState = { intervalMin: row.intervalMin, plannedStartAt: preview.after.startAt, plannedEndAt: preview.after.endAt, delayMin: preview.delayMin, slots: preview.slots.map(s => ({ jobId: s.jobId, at: s.at })) }
    ctx.db.update(containers).set({ plannedStartAt: preview.after.startAt, plannedEndAt: preview.after.endAt, revision: row.revision + 1, updatedAt: now }).where(containerScope(ws, id)).run()
    ctx.db.insert(adjustments).values({ id: newId(), workspaceId: ws, containerId: id, kind: 'drag', beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after), createdAt: now }).run()
    return readContainerWindow(ctx, ws, id)
  }, { behavior: 'immediate' })
}

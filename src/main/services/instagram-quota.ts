import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { publishUncertain } from '@shared/publication-containers'
import { projectQuota, nextQuotaOpening, snapshotFreshness, formatQuotaWindow, QUOTA_SOURCE, type QuotaErrorKind, type QuotaProjection, type QuotaSnapshotView } from '@shared/quota'
import type { Ctx } from '../context'
import type { Db } from '../db/client'
import { jobs, providerLimits, providerQuotaSnapshots as snapshots, publicationHistory } from '../db/schema'
import { providerCooldown, providerSucceeded } from './provider-limiter'

export const QUOTA_OPERATION = 'quota_status'
const PATH = (accountId: string) => `${accountId}/content_publishing_limit?fields=quota_usage,config`
const scope = (ws: string, accountId: string) => and(eq(snapshots.workspaceId, ws), eq(snapshots.provider, 'instagram'), eq(snapshots.accountId, accountId))

/** The provider waits for quota; the queue defers without consuming an attempt. */
export class PublicationQuotaWait extends AppError {
  constructor(public resumeAt: string, public checkedAt: string, public reading: { usage: number; total: number; durationSec: number }) {
    super('internal', 'Quota de publicação da conta esgotada segundo a última consulta à Meta. Publicação adiada.')
  }
}

/** Accepts both the documented `{ data: [ … ] }` envelope and a bare object; rejects anything incomplete. */
const reading = z.object({ quota_usage: z.number().int().min(0), config: z.object({ quota_total: z.number().int().positive(), quota_duration: z.number().int().positive() }) })
export function parseQuotaResponse(raw: unknown) {
  const body = (raw as { data?: unknown[] } | null)?.data?.[0] ?? raw
  const parsed = reading.safeParse(body)
  return parsed.success ? { usage: parsed.data.quota_usage, total: parsed.data.config.quota_total, durationSec: parsed.data.config.quota_duration } : null
}

export function readQuotaSnapshot(db: Db, ws: string, accountId: string, now: Date): QuotaSnapshotView | null {
  const row = db.select().from(snapshots).where(scope(ws, accountId)).get()
  if (!row) return null
  const view = { accountId, source: row.source, usage: row.quotaUsage, total: row.quotaTotal, durationSec: row.quotaDurationSec, fetchedAt: row.fetchedAt,
    attemptedAt: row.attemptedAt, lastStatus: row.lastStatus, errorKind: row.errorKind as QuotaErrorKind | null, errorMessage: row.errorMessage }
  return { ...view, freshness: snapshotFreshness(view, now.toISOString()) }
}

type Outcome = { ok: true; usage: number; total: number; durationSec: number } | { ok: false; kind: QuotaErrorKind; message: string }
/** A failure keeps the last valid reading; it only records when and why the latest attempt failed. */
export function recordQuotaReading(ctx: Ctx, ws: string, accountId: string, outcome: Outcome) {
  const now = ctx.clock().toISOString(), key = { workspaceId: ws, provider: 'instagram', accountId, source: QUOTA_SOURCE }
  const values = outcome.ok
    ? { quotaUsage: outcome.usage, quotaTotal: outcome.total, quotaDurationSec: outcome.durationSec, fetchedAt: now, attemptedAt: now, lastStatus: 'ok' as const, errorKind: null, errorMessage: null }
    : { attemptedAt: now, lastStatus: 'error' as const, errorKind: outcome.kind, errorMessage: outcome.message }
  ctx.db.insert(snapshots).values({ ...key, ...values }).onConflictDoUpdate({ target: [snapshots.workspaceId, snapshots.provider, snapshots.accountId], set: values }).run()
}

function classify(error: unknown): { kind: QuotaErrorKind; message: string; apiError?: { status: number; apiCode: number; retryAfterMs?: number } } {
  const api = error as { status?: unknown; apiCode?: unknown; retryAfterMs?: number }
  if (typeof api?.status === 'number' && typeof api?.apiCode === 'number') {
    const apiError = { status: api.status, apiCode: api.apiCode, retryAfterMs: api.retryAfterMs }
    if (api.status === 429 || [4, 17, 32, 613, 80002].includes(api.apiCode)) return { kind: 'rate_limited', message: 'A Meta limitou as consultas desta conta. A quota será consultada novamente após a espera.', apiError }
    if ([10, 190, 200].includes(api.apiCode) || api.status === 401 || api.status === 403) return { kind: 'permission', message: 'A Meta recusou a consulta de quota. Reconecte a conta com instagram_business_content_publish.' }
    return { kind: 'provider_error', message: `A Meta recusou a consulta de quota (HTTP ${api.status}, código ${api.apiCode || 'indisponível'}).`, apiError: api.status >= 500 ? apiError : undefined }
  }
  // The transport reports an unparseable body with this fixed message; anything else did not reach Meta.
  if (error instanceof AppError && error.message === 'Resposta Instagram inválida.') return { kind: 'invalid_response', message: 'A Meta respondeu com um corpo ilegível.' }
  return { kind: 'network', message: 'Não foi possível consultar a quota. Verifique a conexão.' }
}

/** GET only; never posts. Honors and extends the provider cooldown of this account. */
export async function fetchQuota(ctx: Ctx, ws: string, accountId: string, token: string | null, requestApi: (path: string, token: string) => Promise<unknown>): Promise<QuotaSnapshotView | null> {
  if (!token) { recordQuotaReading(ctx, ws, accountId, { ok: false, kind: 'not_connected', message: 'Conta desconectada. Reconecte para consultar a quota.' }); return readQuotaSnapshot(ctx.db, ws, accountId, ctx.clock()) }
  // App-wide throttling (Meta codes 4/613) is stored with an empty account scope and applies to every account.
  const cooling = ctx.db.select().from(providerLimits).where(and(eq(providerLimits.workspaceId, ws), eq(providerLimits.provider, 'instagram'),
    inArray(providerLimits.accountId, [accountId, '']), eq(providerLimits.operation, QUOTA_OPERATION))).orderBy(sql`${providerLimits.cooldownUntil} desc`).get()
  if (cooling && Date.parse(cooling.cooldownUntil) > ctx.clock().getTime()) {
    recordQuotaReading(ctx, ws, accountId, { ok: false, kind: 'rate_limited', message: `Consulta de quota em espera até ${cooling.cooldownUntil}.` })
    return readQuotaSnapshot(ctx.db, ws, accountId, ctx.clock())
  }
  try {
    const parsed = parseQuotaResponse(await requestApi(PATH(accountId), token))
    recordQuotaReading(ctx, ws, accountId, parsed ? { ok: true, ...parsed } : { ok: false, kind: 'invalid_response', message: 'A Meta respondeu sem quota_usage, quota_total ou quota_duration válidos.' })
    if (parsed) providerSucceeded(ctx, ws, accountId, QUOTA_OPERATION)
  } catch (error) {
    const failure = classify(error)
    if (failure.apiError) providerCooldown(ctx, ws, accountId, QUOTA_OPERATION, failure.apiError)
    recordQuotaReading(ctx, ws, accountId, { ok: false, kind: failure.kind, message: failure.message })
  }
  return readQuotaSnapshot(ctx.db, ws, accountId, ctx.clock())
}

/**
 * Local facts per account: confirmed publications (ledger), remote publications without confirmation,
 * and jobs still planned. Ambiguous jobs are never counted as pending as well.
 */
export function quotaLedger(db: Db, ws: string, accountId: string, since: string | null, excludeJobIds: string[] = []) {
  const confirmed = since ? db.select({ at: publicationHistory.publishedAt }).from(publicationHistory)
    .where(and(eq(publicationHistory.workspaceId, ws), eq(publicationHistory.accountId, accountId), gt(publicationHistory.publishedAt, since))).all() : []
  const rows = db.select({ id: jobs.id, state: jobs.state, runAt: jobs.runAt, updatedAt: jobs.updatedAt, resultJson: jobs.resultJson }).from(jobs)
    .where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'publish_instagram'), inArray(jobs.state, ['queued', 'running', 'failed']),
      sql`json_extract(${jobs.payloadJson}, '$.accountId') = ${accountId}`,
      sql`not exists (select 1 from publication_history h where h.job_id = ${jobs.id})`,
      excludeJobIds.length ? notInArray(jobs.id, excludeJobIds) : undefined)).all()
  const uncertain: { at: string; jobId: string }[] = [], pending: { at: string; jobId: string }[] = []
  for (const row of rows) {
    let checkpoint = {}
    try { checkpoint = JSON.parse(row.resultJson ?? '{}') } catch { /* unreadable checkpoint: treat as not started */ }
    if (publishUncertain(checkpoint)) uncertain.push({ at: row.updatedAt, jobId: row.id })
    else if (row.state !== 'failed') pending.push({ at: row.runAt, jobId: row.id })
  }
  return { confirmed, uncertain, pending }
}

export function accountQuota(ctx: Ctx, ws: string, accountId: string, opts: { candidates?: string[]; excludeJobIds?: string[] } = {}): QuotaProjection {
  const now = ctx.clock(), snapshot = readQuotaSnapshot(ctx.db, ws, accountId, now)
  const since = snapshot?.fetchedAt && snapshot.durationSec ? new Date(Date.parse(snapshot.fetchedAt) - snapshot.durationSec * 1000).toISOString() : null
  const ledger = quotaLedger(ctx.db, ws, accountId, since, opts.excludeJobIds)
  return projectQuota({ snapshot, now: now.toISOString(), confirmed: ledger.confirmed, uncertain: ledger.uncertain,
    pending: [...ledger.pending, ...(opts.candidates ?? []).map(at => ({ at, candidate: true }))] })
}

/** Before preparing a new remote container: wait when a fresh reading already shows no room. Unknown → proceed. */
export function assertPublicationQuota(ctx: Ctx, ws: string, accountId: string) {
  const now = ctx.clock(), snapshot = readQuotaSnapshot(ctx.db, ws, accountId, now)
  if (!snapshot || snapshot.freshness !== 'fresh') return
  const since = new Date(Date.parse(snapshot.fetchedAt!) - snapshot.durationSec! * 1000).toISOString()
  const ledger = quotaLedger(ctx.db, ws, accountId, since)
  const input = { snapshot, now: now.toISOString(), confirmed: ledger.confirmed, uncertain: ledger.uncertain }
  const projection = projectQuota({ ...input, pending: [] })
  if (projection.status !== 'known' || (projection.availableNow ?? 0) > 0) return
  const opening = nextQuotaOpening(input)
  if (opening) throw new PublicationQuotaWait(opening, snapshot.fetchedAt!, { usage: snapshot.usage!, total: snapshot.total!, durationSec: snapshot.durationSec! })
}

/**
 * Runs inside the schedule transaction, after the new jobs exist: concurrent schedules serialize on the
 * IMMEDIATE lock, so the second one sees the first one's reservations. Unknown capacity never blocks.
 */
export function assertScheduleQuota(ctx: Ctx, ws: string, accountId: string, jobIds: string[], timeZone: string) {
  const after = accountQuota(ctx, ws, accountId)
  if (after.status !== 'known' || !after.overLimit) return
  const before = accountQuota(ctx, ws, accountId, { excludeJobIds: jobIds })
  const alreadyOver = new Set(before.slots.filter(s => !s.withinLimit).map(s => s.jobId))
  const own = after.slots.filter(s => !s.withinLimit && jobIds.includes(s.jobId!))
  const pushed = after.slots.filter(s => !s.withinLimit && !jobIds.includes(s.jobId!) && !alreadyOver.has(s.jobId))
  if (!own.length && !pushed.length) return
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  const quota = `${after.limit} publicações em ${formatQuotaWindow(after.windowSec!)}, consulta de ${when(after.snapshot!.fetchedAt!)}`
  throw new AppError('invalid_input', own.length
    ? `A quota informada pela Meta (${quota}) não comporta ${own.length} publicação(ões) deste agendamento; a primeira em ${when(own[0].at)}. Revise início ou intervalo.`
    : `Este agendamento levaria ${pushed.length} publicação(ões) já agendada(s) desta conta além da quota informada pela Meta (${quota}). Revise início ou intervalo.`)
}

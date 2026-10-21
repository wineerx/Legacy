/**
 * Quota-aware planning for one provider account. Limits and window come from the provider at runtime;
 * nothing here assumes a number of posts or a window length.
 *
 * Counting rule that prevents double counting: everything that happened up to the snapshot time T0 is the
 * provider's business and is represented by `quota_usage`. Local records only add what happened after T0
 * (confirmed publications, ambiguous remote operations) and what is still planned (pending jobs).
 */
export const QUOTA_SOURCE = 'instagram.content_publishing_limit'
/** A reading older than this no longer supports a capacity estimate. Shown, but marked as stale. */
export const QUOTA_FRESH_MS = 15 * 60_000

export type QuotaErrorKind = 'not_connected' | 'network' | 'rate_limited' | 'permission' | 'invalid_response' | 'provider_error'
export type QuotaFreshness = 'fresh' | 'stale' | 'missing'
export interface QuotaSnapshotView {
  accountId: string; source: string
  usage: number | null; total: number | null; durationSec: number | null
  /** Time of the last valid reading; null when no reading ever succeeded. */
  fetchedAt: string | null
  attemptedAt: string; lastStatus: 'ok' | 'error'
  errorKind: QuotaErrorKind | null; errorMessage: string | null
  freshness: QuotaFreshness
}
export interface QuotaInput {
  snapshot: QuotaSnapshotView | null
  now: string
  confirmed: { at: string }[]
  uncertain: { at: string }[]
  pending: { at: string; jobId?: string; candidate?: boolean }[]
}
export interface QuotaSlot { at: string; jobId?: string; candidate: boolean; inWindow: number; withinLimit: boolean }
export interface QuotaProjection {
  status: 'known' | 'unknown'
  reason: string | null
  snapshot: QuotaSnapshotView | null
  limit: number | null; windowSec: number | null
  breakdown: { official: number | null; confirmedAfterSnapshot: number; uncertainAfterSnapshot: number; pending: number; candidates: number }
  /** Publications still possible right now, after everything local that already counts. */
  availableNow: number | null
  slots: QuotaSlot[]
  overLimit: number
}

export function snapshotFreshness(snapshot: Pick<QuotaSnapshotView, 'fetchedAt' | 'total' | 'durationSec' | 'usage'> | null, now: string): QuotaFreshness {
  if (!snapshot?.fetchedAt || snapshot.total === null || snapshot.durationSec === null || snapshot.usage === null) return 'missing'
  return Date.parse(now) - Date.parse(snapshot.fetchedAt) > QUOTA_FRESH_MS ? 'stale' : 'fresh'
}

const unknown = (input: QuotaInput, reason: string): QuotaProjection => ({
  status: 'unknown', reason, snapshot: input.snapshot, limit: input.snapshot?.total ?? null, windowSec: input.snapshot?.durationSec ?? null,
  breakdown: { official: input.snapshot?.usage ?? null, confirmedAfterSnapshot: 0, uncertainAfterSnapshot: 0,
    pending: input.pending.filter(p => !p.candidate).length, candidates: input.pending.filter(p => p.candidate).length },
  availableNow: null, slots: [], overLimit: 0
})

/** Times at which quota is consumed, known or conservatively assumed. Pending items never run before now. */
function consumption(input: QuotaInput, t0: number, windowMs: number, usage: number) {
  const now = Date.parse(input.now)
  const pre = input.confirmed.map(c => Date.parse(c.at)).filter(at => at > t0 - windowMs && at <= t0).sort((a, b) => b - a)
  // The provider's count already includes these; keep the most recent local ones with their real times and
  // place the rest (other apps, or unknown times) at T0, which is the latest they could have happened.
  const attributed = pre.slice(0, usage)
  const events = [...attributed, ...Array(Math.max(0, usage - attributed.length)).fill(t0)]
  const confirmedAfter = input.confirmed.map(c => Date.parse(c.at)).filter(at => at > t0)
  const uncertainAfter = input.uncertain.map(c => Date.parse(c.at)).filter(at => at > t0)
  return { fixed: [...events, ...confirmedAfter, ...uncertainAfter], confirmedAfter: confirmedAfter.length, uncertainAfter: uncertainAfter.length,
    pending: input.pending.map(p => ({ ...p, time: Math.max(now, Date.parse(p.at)) })).sort((a, b) => a.time - b.time || Number(a.candidate) - Number(b.candidate)) }
}
const inWindow = (times: number[], t: number, windowMs: number) => times.filter(e => e > t - windowMs && e <= t).length

export function projectQuota(input: QuotaInput): QuotaProjection {
  const s = input.snapshot
  if (!s) return unknown(input, 'Quota ainda não consultada para esta conta.')
  const freshness = snapshotFreshness(s, input.now)
  if (freshness === 'missing') return unknown(input, s.lastStatus === 'error' ? 'A consulta de quota falhou e não há leitura válida.' : 'A resposta de quota não trouxe limite e janela.')
  if (freshness === 'stale') return unknown(input, 'A última leitura válida está desatualizada. Atualize a quota para estimar a capacidade.')
  const limit = s.total!, windowMs = s.durationSec! * 1000, t0 = Date.parse(s.fetchedAt!)
  if (!(limit > 0) || !(windowMs > 0) || s.usage! < 0) return unknown(input, 'Valores de quota inválidos.')
  const { fixed, confirmedAfter, uncertainAfter, pending } = consumption(input, t0, windowMs, s.usage!)
  const now = Date.parse(input.now), placed = [...fixed]
  const slots: QuotaSlot[] = []
  // In time order, an earlier item only affects later windows. An item over the limit is refused by the
  // provider and postponed, so it does not consume quota at its planned time.
  for (const p of pending) {
    const count = inWindow(placed, p.time, windowMs) + 1, withinLimit = count <= limit
    if (withinLimit) placed.push(p.time)
    slots.push({ at: new Date(p.time).toISOString(), jobId: p.jobId, candidate: Boolean(p.candidate), inWindow: count, withinLimit })
  }
  return {
    status: 'known', reason: null, snapshot: s, limit, windowSec: s.durationSec,
    breakdown: { official: s.usage, confirmedAfterSnapshot: confirmedAfter, uncertainAfterSnapshot: uncertainAfter,
      pending: pending.filter(p => !p.candidate).length, candidates: pending.filter(p => p.candidate).length },
    availableNow: Math.max(0, limit - inWindow(fixed, now, windowMs)),
    slots, overLimit: slots.filter(v => !v.withinLimit).length
  }
}

/**
 * Earliest time at which one more publication fits, given only consumption that already happened.
 * Returns null when the data is not trustworthy enough to tell.
 */
export function nextQuotaOpening(input: Omit<QuotaInput, 'pending'>): string | null {
  const s = input.snapshot
  if (!s || snapshotFreshness(s, input.now) !== 'fresh') return null
  const limit = s.total!, windowMs = s.durationSec! * 1000
  const { fixed } = consumption({ ...input, pending: [] }, Date.parse(s.fetchedAt!), windowMs, s.usage!)
  const now = Date.parse(input.now)
  for (const t of [now, ...fixed.map(e => e + windowMs).filter(t => t > now).sort((a, b) => a - b)])
    if (inWindow(fixed, t, windowMs) + 1 <= limit) return new Date(t).toISOString()
  return null
}

/** Window length as the provider reported it, in the largest exact unit. */
export const formatQuotaWindow = (sec: number) => sec % 3600 === 0 ? `${sec / 3600} h` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`

/**
 * Consumption already fixed for an account (provider usage at T0 plus local facts after it), for planners
 * that place their own items. Null when the reading cannot support an estimate.
 */
export function quotaTimeline(input: Omit<QuotaInput, 'pending'>): { limit: number; windowMs: number; fixed: number[] } | null {
  const s = input.snapshot
  if (!s || snapshotFreshness(s, input.now) !== 'fresh' || !(s.total! > 0) || !(s.durationSec! > 0)) return null
  const windowMs = s.durationSec! * 1000
  return { limit: s.total!, windowMs, fixed: consumption({ ...input, pending: [] }, Date.parse(s.fetchedAt!), windowMs, s.usage!).fixed }
}
/** Earliest time ≥ `from` where one more publication fits, given every time already placed. */
export function firstQuotaFit(placed: number[], from: number, limit: number, windowMs: number): number {
  for (const t of [from, ...placed.map(e => e + windowMs).filter(t => t > from).sort((a, b) => a - b)])
    if (placed.filter(e => e > t - windowMs && e <= t).length + 1 <= limit) return t
  return from
}

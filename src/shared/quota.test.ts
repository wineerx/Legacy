import { expect, it } from 'vitest'
import { projectQuota, nextQuotaOpening, snapshotFreshness, QUOTA_FRESH_MS, type QuotaSnapshotView } from './quota'

const T0 = '2026-10-10T12:00:00.000Z'
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString()
const snap = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({ accountId: '111', source: 'test', usage: 0, total: 5, durationSec: 3600,
  fetchedAt: T0, attemptedAt: T0, lastStatus: 'ok', errorKind: null, errorMessage: null, freshness: 'fresh', ...over })
const base = { now: T0, confirmed: [], uncertain: [], pending: [] }

it('uses limit and window returned by the provider, whatever they are', () => {
  for (const [total, durationSec] of [[5, 3600], [50, 86400], [3, 600], [100, 172800]]) {
    const p = projectQuota({ ...base, snapshot: snap({ usage: 1, total, durationSec }) })
    expect(p).toMatchObject({ status: 'known', limit: total, windowSec: durationSec, availableNow: total - 1 })
  }
})

it('does not count twice a local publication already reflected in the official usage', () => {
  // Two local confirmations before T0 are inside quota_usage=2; one after T0 is not.
  const p = projectQuota({ ...base, snapshot: snap({ usage: 2 }), confirmed: [{ at: at(-30) }, { at: at(-10) }, { at: at(5) }], now: at(6) })
  expect(p.breakdown).toMatchObject({ official: 2, confirmedAfterSnapshot: 1 })
  expect(p.availableNow).toBe(2)
  // Confirmations older than the window are irrelevant.
  expect(projectQuota({ ...base, snapshot: snap({ usage: 0 }), confirmed: [{ at: at(-61) }] }).availableNow).toBe(5)
})

it('uncertain remote operations count only after the snapshot; before it the provider already decided', () => {
  const p = projectQuota({ ...base, snapshot: snap({ usage: 1 }), uncertain: [{ at: at(-5) }, { at: at(1) }], now: at(2) })
  expect(p.breakdown.uncertainAfterSnapshot).toBe(1)
  expect(p.availableNow).toBe(3)
})

it('rolling window: capacity returns as known publications expire; unattributed usage is assumed at T0', () => {
  // usage 5 = limit; one local confirmation at -50 min frees a slot at +10 min, the other four only at +60.
  const input = { ...base, snapshot: snap({ usage: 5 }), confirmed: [{ at: at(-50) }] }
  expect(projectQuota(input).availableNow).toBe(0)
  expect(nextQuotaOpening(input)).toBe(at(10))
  const plan = projectQuota({ ...input, pending: [{ at: at(5), candidate: true }, { at: at(15), candidate: true }, { at: at(25), candidate: true }] })
  expect(plan.slots.map(s => s.withinLimit)).toEqual([false, true, false])
  expect(plan.overLimit).toBe(2)
  expect(projectQuota({ ...input, pending: [{ at: at(61), candidate: true }] }).slots[0].withinLimit).toBe(true)
})

it('a new Container that fits by itself can push an already planned job over the limit', () => {
  const pending = [{ at: at(50), jobId: 'existing' }, ...[10, 20, 30].map(m => ({ at: at(m), candidate: true }))]
  const p = projectQuota({ ...base, snapshot: snap({ usage: 1, total: 4 }), pending })
  expect(p.slots.find(s => s.jobId === 'existing')).toMatchObject({ inWindow: 5, withinLimit: false })
  expect(p.slots.filter(s => s.candidate).every(s => s.withinLimit)).toBe(true)
})

it('pending items in the past are placed now, never before', () => {
  const p = projectQuota({ ...base, snapshot: snap(), now: at(3), pending: [{ at: at(-20), jobId: 'late' }] })
  expect(p.slots[0].at).toBe(at(3))
})

it('missing, failed, incomplete and stale readings yield unknown capacity, never invented limits', () => {
  expect(projectQuota({ ...base, snapshot: null })).toMatchObject({ status: 'unknown', availableNow: null, limit: null })
  expect(projectQuota({ ...base, snapshot: snap({ fetchedAt: null, usage: null, total: null, durationSec: null, lastStatus: 'error', errorKind: 'network' }) }).reason).toMatch(/falhou/)
  expect(projectQuota({ ...base, snapshot: snap({ total: null }) }).status).toBe('unknown')
  const stale = projectQuota({ ...base, snapshot: snap(), now: new Date(Date.parse(T0) + QUOTA_FRESH_MS + 1).toISOString() })
  expect(stale).toMatchObject({ status: 'unknown', availableNow: null, limit: 5 })
  expect(stale.reason).toMatch(/desatualizada/)
  expect(nextQuotaOpening({ ...base, snapshot: snap(), now: at(16) })).toBeNull()
  expect(snapshotFreshness(snap(), at(15))).toBe('fresh')
  expect(projectQuota({ ...base, snapshot: snap({ total: 0 }) }).status).toBe('unknown')
})

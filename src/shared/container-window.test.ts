import { describe, expect, it } from 'vitest'
import { estimateWindow, proposeAdjustments, type WindowInput, type WindowItem } from './container-window'
import type { QuotaSnapshotView } from './quota'

const T = (hhmm: string) => `2026-10-12T${hhmm}:00.000Z`
const snap = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({ accountId: '111', source: 't', usage: 0, total: 50, durationSec: 86400, fetchedAt: T('14:55'),
  attemptedAt: T('14:55'), lastStatus: 'ok', errorKind: null, errorMessage: null, freshness: 'fresh', ...over })
/** Roadmap example: 12 items 13:00→15:45 every 15 min; `done` already confirmed. */
function items(done: number, runAt = (i: number) => new Date(Date.parse(T('13:00')) + i * 15 * 60_000).toISOString(), extra: (Partial<WindowItem> | undefined)[] = []): WindowItem[] {
  return Array.from({ length: 12 }, (_, i) => ({ jobId: `j${i}`, position: i, state: i < done ? 'done' : 'queued', confirmed: i < done, runAt: runAt(i), remote: false, ...extra[i] }))
}
const input = (over: Partial<WindowInput> = {}): WindowInput => ({ plannedStartAt: T('13:00'), plannedEndAt: T('15:45'), intervalMin: 15, control: 'active', scheduled: true,
  now: T('15:00'), items: items(9), quota: { snapshot: null, confirmed: [], uncertain: [], others: [] }, ...over })
const move = { windows: [{ start: '18:00', end: '21:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }], timeZone: 'UTC', fromDate: '2026-10-12', reserved: [], horizonDays: 90 }

describe('estimate', () => {
  it('on time: published, remaining and estimated end equal the plan', () => {
    expect(estimateWindow(input())).toMatchObject({ status: 'on_time', published: 9, remaining: 3, estimatedEndAt: T('15:45'), delayMin: 0, overdue: 0 })
  })

  it('late: quota deferral moved run_at → the window will be exceeded by N minutes', () => {
    const late = items(8, i => i < 8 ? T('13:00') : new Date(Date.parse(T('15:07')) + (i - 8) * 15 * 60_000).toISOString())
    expect(estimateWindow(input({ now: T('14:55'), items: late }))).toMatchObject({ status: 'late', remaining: 4, delayMin: 7, estimatedEndAt: T('15:52') })
  })

  it('items already started remotely count as now, never by their polling run_at; overdue fresh items are flagged', () => {
    const w = estimateWindow(input({ now: T('16:00'), items: items(9, undefined, [, , , , , , , , , { remote: true, runAt: T('16:10') }]) }))
    expect(w).toMatchObject({ inFlight: 1, overdue: 2, status: 'late', estimatedEndAt: T('16:00'), delayMin: 15 })
  })

  it('paused suspends the estimate; cancelled and finished have none', () => {
    expect(estimateWindow(input({ control: 'paused' }))).toMatchObject({ status: 'paused', estimatedEndAt: null, delayMin: null, remaining: 3 })
    expect(estimateWindow(input({ control: 'cancelled' }))).toMatchObject({ status: 'cancelled', estimatedEndAt: null })
    expect(estimateWindow(input({ items: items(12) }))).toMatchObject({ status: 'finished', published: 12, remaining: 0 })
    expect(estimateWindow(input({ scheduled: false }))).toMatchObject({ status: 'not_scheduled' })
    const failed = items(9, undefined, [, , , , , , , , , { state: 'failed' }, { state: 'failed' }, { state: 'failed' }])
    expect(estimateWindow(input({ items: failed }))).toMatchObject({ status: 'finished', failed: 3 })
  })

  it('known quota pushes items to when the provider window allows; unknown quota is not considered', () => {
    // 50 of 50 used at 14:55 within 24 h, last publications local at 15:30 and 15:40 inside the window.
    const quota = { snapshot: snap({ usage: 48, total: 50 }), confirmed: [], uncertain: [], others: [] }
    const w = estimateWindow(input({ quota }))
    expect(w).toMatchObject({ quotaConsidered: true, status: 'late' })
    expect(Date.parse(w.estimatedEndAt!)).toBe(Date.parse(T('14:55')) + 86_400_000)
    expect(estimateWindow(input({ quota: { ...quota, snapshot: snap({ freshness: 'stale', fetchedAt: T('10:00') }) } }))).toMatchObject({ quotaConsidered: false, status: 'on_time' })
  })
})

describe('proposals', () => {
  const lateInput = () => input({ now: T('14:55'), items: items(6, i => i < 6 ? T('13:00') : new Date(Date.parse(T('15:00')) + (i - 6) * 15 * 60_000).toISOString()) })

  it('only for a late, active Container; keep is always offered first', () => {
    expect(proposeAdjustments(input(), estimateWindow(input()), move).proposals).toEqual([])
    const late = lateInput(), w = estimateWindow(late)
    expect(w).toMatchObject({ status: 'late', delayMin: 30 })
    const { proposals, unavailable } = proposeAdjustments(late, w, move)
    // At the 15 min product minimum there is nothing to reduce; the reason is shown instead.
    expect(proposals.map(p => p.kind)).toEqual(['keep', 'move'])
    expect(unavailable).toEqual([{ kind: 'reduce', reason: 'O intervalo já está no mínimo de 15 min.' }])
    expect(proposals[0]).toEqual({ kind: 'keep', estimatedEndAt: T('16:15'), delayMin: 30 })
  })

  it('reduce compresses the remaining fresh items toward the planned end, never below 15 min nor touching started ones', () => {
    // 30 min Container, 6 left from 14:30 → would end 17:00 (75 min late); j6 already started remotely.
    const late = input({ intervalMin: 30, now: T('14:20'), items: items(6, i => i < 6 ? T('13:00') : new Date(Date.parse(T('14:30')) + (i - 6) * 30 * 60_000).toISOString()) })
    late.items[6] = { ...late.items[6], remote: true }
    const p = proposeAdjustments(late, estimateWindow(late), move).proposals.find(v => v.kind === 'reduce')!
    expect(p).toMatchObject({ kind: 'reduce', intervalMin: 15 })
    expect(p.kind === 'reduce' && p.slots.map(s => s.jobId)).toEqual(['j7', 'j8', 'j9', 'j10', 'j11'])
    const wide = input({ intervalMin: 30, now: T('14:00'), plannedEndAt: T('15:45'), items: items(6, i => i < 6 ? T('13:00') : new Date(Date.parse(T('14:30')) + (i - 6) * 30 * 60_000).toISOString()) })
    const r = proposeAdjustments(wide, estimateWindow(wide), move).proposals.find(v => v.kind === 'reduce')!
    expect(r.kind === 'reduce' && [r.intervalMin, r.slots[0].at, r.estimatedEndAt, r.delayMin]).toEqual([15, T('14:30'), T('15:45'), 0])
  })

  it('reduce is explained when not possible: already at 15 min with nothing to gain, or a single remaining video', () => {
    const one = input({ now: T('16:00'), items: items(11, i => i < 11 ? T('13:00') : T('16:30')) })
    const set = proposeAdjustments(one, estimateWindow(one), move)
    expect(set.unavailable.find(u => u.kind === 'reduce')?.reason).toMatch(/só um vídeo/)
    const atMin = lateInput()
    expect(proposeAdjustments(atMin, estimateWindow(atMin), move).unavailable.find(u => u.kind === 'reduce')?.reason).toMatch(/mínimo de 15 min/)
    // Delay caused by quota, not spacing: a 60 min Container already fitting its end gains nothing.
    const quotaLate = input({ intervalMin: 60, plannedEndAt: T('17:00'), now: T('15:00'), items: items(10, i => i < 10 ? T('13:00') : new Date(Date.parse(T('16:00')) + (i - 10) * 60 * 60_000).toISOString()),
      quota: { snapshot: snap({ usage: 50, total: 50 }), confirmed: [], uncertain: [], others: [] } })
    expect(proposeAdjustments(quotaLate, estimateWindow(quotaLate), move).unavailable.find(u => u.kind === 'reduce')?.reason).toMatch(/não vem do intervalo/)
  })

  it('move uses the next free peak window with the same interval; without windows it says why', () => {
    const late = lateInput()
    const m = proposeAdjustments(late, estimateWindow(late), move).proposals.find(v => v.kind === 'move')!
    expect(m.kind === 'move' && [m.startAt, m.slots.length, m.estimatedEndAt]).toEqual([T('18:00'), 6, T('19:15')])
    const none = proposeAdjustments(late, estimateWindow(late), { ...move, windows: [] })
    expect(none.unavailable).toContainEqual({ kind: 'move', reason: 'Configure janelas de pico para mover o restante.' })
  })
})

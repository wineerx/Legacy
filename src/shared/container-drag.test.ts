import { describe, expect, it } from 'vitest'
import { previewDrag, snapMinutes, type DragInput } from './container-drag'
import type { WindowInput, WindowItem } from './container-window'
import type { QuotaSnapshotView } from './quota'

const T = (hhmm: string, day = '12') => `2026-10-${day}T${hhmm}:00.000Z`
const at = (i: number, from = T('13:00')) => new Date(Date.parse(from) + i * 15 * 60_000).toISOString()
function items(done: number, extra: (Partial<WindowItem> | undefined)[] = []): WindowItem[] {
  return Array.from({ length: 12 }, (_, i) => ({ jobId: `j${i}`, position: i, state: i < done ? 'done' : 'queued', confirmed: i < done, runAt: at(i), remote: false, ...extra[i] }))
}
const windowInput = (over: Partial<WindowInput> = {}): WindowInput => ({ plannedStartAt: T('13:00'), plannedEndAt: T('15:45'), intervalMin: 15, control: 'active', scheduled: true,
  now: T('10:00'), items: items(0), quota: { snapshot: null, confirmed: [], uncertain: [], others: [] }, ...over })
const drag = (over: Partial<DragInput> = {}, w: Partial<WindowInput> = {}): DragInput => ({ window: windowInput(w), planned: {}, targetStartAt: T('17:00'), reserved: [], peak: { windows: [], timeZone: 'UTC' }, ...over })
const snap = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({ accountId: '111', source: 't', usage: 0, total: 50, durationSec: 86400, fetchedAt: T('09:55'),
  attemptedAt: T('09:55'), lastStatus: 'ok', errorKind: null, errorMessage: null, freshness: 'fresh', ...over })

describe('drag preview', () => {
  it('shifts the planned window and every fresh item by the same delta', () => {
    const p = previewDrag(drag())
    expect(p).toMatchObject({ blocked: null, deltaMin: 240, before: { startAt: T('13:00'), endAt: T('15:45') }, after: { startAt: T('17:00'), endAt: T('19:45'), estimatedEndAt: T('19:45') }, delayMin: 0, quotaDeferred: 0, insidePeak: null })
    expect(p.slots.map(s => s.at)).toEqual(Array.from({ length: 12 }, (_, i) => at(i, T('17:00'))))
    expect(p.slots[0].before).toBe(T('13:00'))
  })

  it('keeps the plan shape (planned_publish_at), not a quota-deferred run_at', () => {
    const deferred = items(0).map((i, k) => ({ ...i, runAt: at(k + 4) }))
    const planned = Object.fromEntries(deferred.map((i, k) => [i.jobId, at(k)]))
    expect(previewDrag(drag({ planned }, { items: deferred })).slots[0].at).toBe(T('17:00'))
  })

  it('published, in-flight and failed items never move; the moved list holds only fresh items', () => {
    const w = items(4, [, , , , { remote: true }, { state: 'running' }, { state: 'failed' }])
    const p = previewDrag(drag({}, { items: w, now: T('14:10') }))
    expect(p.unchanged).toEqual({ published: 4, inFlight: 2, failed: 1 })
    expect(p.slots.map(s => s.jobId)).toEqual(['j7', 'j8', 'j9', 'j10', 'j11'])
    expect(p.slots[0].at).toBe(at(7, T('17:00')))
  })

  it('blocks drafts, paused, cancelled, the past, no-op drops and Containers with nothing left', () => {
    expect(previewDrag(drag({}, { scheduled: false })).blocked).toMatch(/Rascunhos/)
    expect(previewDrag(drag({}, { control: 'paused' })).blocked).toMatch(/Retome/)
    expect(previewDrag(drag({}, { control: 'cancelled' })).blocked).toMatch(/cancelados/)
    expect(previewDrag(drag({ targetStartAt: T('09:00') })).blocked).toBe('Escolha um horário no futuro.')
    expect(previewDrag(drag({ targetStartAt: T('13:00') })).blocked).toBe('O Container já está neste horário.')
    expect(previewDrag(drag({}, { items: items(12) })).blocked).toMatch(/Nenhum vídeo/)
    expect(previewDrag(drag({ targetStartAt: T('09:00') })).slots).toEqual([])
  })

  it('known quota defers items past the limit and reports the delay against the shifted window', () => {
    // 45 of 50 used in the last 24 h: only 5 more fit before the window rolls.
    const p = previewDrag(drag({}, { quota: { snapshot: snap({ usage: 45 }), confirmed: [], uncertain: [], others: [] } }))
    expect(p.quotaConsidered).toBe(true)
    expect(p.quotaDeferred).toBe(7)
    expect(p.delayMin).toBeGreaterThan(0)
    expect(Date.parse(p.after.estimatedEndAt!)).toBeGreaterThan(Date.parse(p.after.endAt!))
  })

  it('flags overlaps with other programming of the account and the peak-window fit', () => {
    const reserved = [{ start: T('18:00'), end: T('18:30') }, { start: T('22:00'), end: T('23:00') }]
    const peak = { windows: [{ start: '16:00', end: '21:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }], timeZone: 'UTC' }
    const p = previewDrag(drag({ reserved, peak }))
    expect(p.conflicts).toEqual([reserved[0]])
    expect(p.insidePeak).toBe(true)
    expect(previewDrag(drag({ peak, targetStartAt: T('19:00') })).insidePeak).toBe(false)
  })

  it('snaps to the 15 min grid inside the day', () => {
    expect([snapMinutes(7), snapMinutes(8), snapMinutes(-30), snapMinutes(1439)]).toEqual([0, 15, 0, 1425])
  })
})

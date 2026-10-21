import { describe, expect, it } from 'vitest'
import { peakWindows, findOverlap, windowOccurrences, distributeContainers, type DistributionInput, type PeakWindow } from './peak-windows'
import { planSlots } from './schedule'
import type { QuotaSnapshotView } from './quota'

const all = [0, 1, 2, 3, 4, 5, 6]
const w = (start: string, end: string, weekdays = all): PeakWindow => ({ start, end, weekdays })
const SP = 'America/Sao_Paulo'
const snap = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({ accountId: '111', source: 't', usage: 0, total: 50, durationSec: 86400, fetchedAt: '2026-10-11T23:00:00.000Z',
  attemptedAt: '2026-10-11T23:00:00.000Z', lastStatus: 'ok', errorKind: null, errorMessage: null, freshness: 'fresh', ...over })
const base = (over: Partial<DistributionInput> = {}): DistributionInput => ({
  containers: ['A', 'B', 'C', 'D'].map(id => ({ id, count: 12, intervalMin: 15 })),
  windows: [w('09:00', '12:00'), w('13:00', '16:00'), w('17:00', '20:00'), w('21:00', '00:00')],
  timeZone: SP, fromDate: '2026-10-12', now: '2026-10-11T23:00:00.000Z', reserved: [], horizonDays: 90,
  quota: { snapshot: snap(), confirmed: [], uncertain: [], pending: [] }, ...over })
const local = (iso: string, timeZone = SP) => new Date(iso).toLocaleString('sv-SE', { timeZone }).slice(0, 16)

describe('configuration', () => {
  it('accepts disjoint windows, including one that crosses midnight, and rejects overlaps, equal bounds, bad times and empty days', () => {
    expect(peakWindows.safeParse([w('09:00', '12:00'), w('22:00', '02:00')]).success).toBe(true)
    expect(peakWindows.safeParse([]).success).toBe(true)
    expect(findOverlap([w('09:00', '12:00'), w('11:59', '13:00')])).toEqual([0, 1])
    // Saturday 23:00→01:00 reaches Sunday 00:30.
    expect(findOverlap([w('23:00', '01:00', [6]), w('00:30', '02:00', [0])])).toEqual([0, 1])
    expect(findOverlap([w('23:00', '01:00', [6]), w('00:30', '02:00', [1])])).toBeNull()
    expect(findOverlap([w('09:00', '12:00'), w('12:00', '13:00')])).toBeNull()
    for (const bad of [[w('09:00', '09:00')], [w('9:00', '12:00')], [w('24:00', '01:00')], [w('09:00', '12:00', [])], [w('09:00', '12:00', [1, 1])], Array.from({ length: 13 }, (_, i) => w(`${String(i).padStart(2, '0')}:00`, `${String(i).padStart(2, '0')}:30`))])
      expect(peakWindows.safeParse(bad).success).toBe(false)
  })

  it('occurrences honor weekdays, midnight crossing and DST gaps in the configured zone', () => {
    const [occ] = windowOccurrences([w('22:00', '02:00', [1])], SP, '2026-10-12', '2026-10-12')
    expect([local(new Date(occ.start).toISOString()), local(new Date(occ.end).toISOString())]).toEqual(['2026-10-12 22:00', '2026-10-13 02:00'])
    // New York springs forward on 2026-03-08: 02:00–03:00 does not exist. 01:00→04:00 lasts two real hours.
    const [ny] = windowOccurrences([w('01:00', '04:00')], 'America/New_York', '2026-03-08', '2026-03-08')
    expect((ny.end - ny.start) / 3_600_000).toBe(2)
    const [back] = windowOccurrences([w('01:00', '04:00')], 'America/New_York', '2026-11-01', '2026-11-01')
    expect((back.end - back.start) / 3_600_000).toBe(4)
  })

  it('planSlots now fills midnight-crossing windows, counted for the day they start', () => {
    const r = planSlots({ count: 3, startDate: '2026-10-12', timeZone: SP, windows: [{ start: '23:00', end: '01:00' }], weekdays: all, minIntervalMin: 60, maxPerDay: 2, now: new Date('2026-10-12T00:00:00Z') })
    expect(r.slots.map(s => local(s))).toEqual(['2026-10-12 23:00', '2026-10-13 00:00', '2026-10-13 23:00'])
  })
})

describe('distribution', () => {
  it('reproduces the roadmap example: 4 × 12 videos at 15 min land in successive peak windows, in order', () => {
    const r = distributeContainers(base())
    expect(r.placements.map(p => p.placed && `${local(p.start).slice(11)}→${local(p.end).slice(11)}`)).toEqual(['09:00→11:45', '13:00→15:45', '17:00→19:45', '21:00→23:45'])
    expect(r.placements.every(p => p.placed && p.slots.every((s, i) => i === 0 || Date.parse(s) - Date.parse(p.slots[i - 1]) === 15 * 60_000))).toBe(true)
    expect(r.quota.status).toBe('known')
    expect([r.peakInWindow, r.quota.limit]).toEqual([48, 50])
  })

  it('never splits a Container nor changes its interval: too long for every window → unplaced with the reason', () => {
    const r = distributeContainers(base({ containers: [{ id: 'long', count: 20, intervalMin: 15 }] }))
    expect(r.placements[0]).toEqual({ id: 'long', placed: false, reason: 'A sequência de 20 vídeo(s) a cada 15 min não cabe em nenhuma janela.' })
  })

  it('keeps its own interval away from existing reservations and never moves them', () => {
    const reserved = [{ start: '2026-10-12T12:00:00.000Z', end: '2026-10-12T13:00:00.000Z' }] // 09:00–10:00 local
    const r = distributeContainers(base({ containers: [{ id: 'A', count: 4, intervalMin: 15 }], reserved }))
    expect(r.placements[0].placed && local(r.placements[0].start)).toBe('2026-10-12 10:15')
    expect(reserved).toEqual([{ start: '2026-10-12T12:00:00.000Z', end: '2026-10-12T13:00:00.000Z' }])
  })

  it('a midnight-crossing window hosts a Container across the date change', () => {
    const r = distributeContainers(base({ windows: [w('23:00', '01:00')], containers: [{ id: 'N', count: 5, intervalMin: 30 }] }))
    expect(r.placements[0].placed && [local(r.placements[0].start), local(r.placements[0].end)]).toEqual(['2026-10-12 23:00', '2026-10-13 01:00'])
  })

  it('across a DST change the interval stays absolute and the window bound is checked in real time', () => {
    // 2026-11-01 New York falls back at 02:00: 00:30→03:30 local is four real hours.
    const r = distributeContainers(base({ timeZone: 'America/New_York', fromDate: '2026-11-01', now: '2026-10-31T12:00:00.000Z', windows: [w('00:30', '03:30', [0])], containers: [{ id: 'X', count: 5, intervalMin: 60 }] }))
    const p = r.placements[0]
    expect(p.placed && (Date.parse(p.end) - Date.parse(p.start)) / 3_600_000).toBe(4)
  })

  it('known quota: a Container that would exceed the provider limit moves to a later window; the limit and window come from the reading', () => {
    // Limit 18 per 6 h: A (12) fits at 09:00; B at 13:00 would reach 20 inside one 6 h window → 17:00.
    const r = distributeContainers(base({ containers: [{ id: 'A', count: 12, intervalMin: 15 }, { id: 'B', count: 12, intervalMin: 15 }], quota: { snapshot: snap({ total: 18, durationSec: 21600 }), confirmed: [], uncertain: [], pending: [] } }))
    expect(r.placements.map(p => p.placed && local(p.start).slice(11))).toEqual(['09:00', '17:00'])
    expect(r.quota.overLimit).toBe(0)
    expect(r.peakInWindow).toBeLessThanOrEqual(18)
  })

  it('quota with no room anywhere leaves the Container unplaced with the quota reason', () => {
    // 50/50 read at T0 frees only at T0 + 24 h (20:00 local on the 12th); the only windows before that are taken.
    const r = distributeContainers(base({ windows: [w('09:00', '12:00'), w('13:00', '16:00')], containers: [{ id: 'A', count: 3, intervalMin: 15 }], horizonDays: 1, quota: { snapshot: snap({ usage: 50 }), confirmed: [], uncertain: [], pending: [] } }))
    expect(r.placements[0]).toMatchObject({ placed: false, reason: 'A quota informada pela Meta não comporta este Container nas janelas disponíveis.' })
  })

  it('unknown or stale quota never blocks nor invents capacity (PR 05 policy)', () => {
    for (const snapshot of [null, snap({ freshness: 'stale', fetchedAt: '2026-10-11T20:00:00.000Z' })]) {
      const r = distributeContainers(base({ quota: { snapshot, confirmed: [], uncertain: [], pending: [] } }))
      expect(r.placements.every(p => p.placed)).toBe(true)
      expect(r).toMatchObject({ quota: { status: 'unknown', availableNow: null }, peakInWindow: null })
    }
  })

  it('no windows, past dates and the 90-day horizon', () => {
    expect(distributeContainers(base({ windows: [] })).placements[0]).toMatchObject({ placed: false })
    // Already inside the 09:00 window (10:30 local): starts one minute from now, never in the past.
    const later = distributeContainers(base({ now: '2026-10-12T13:30:00.000Z', containers: [{ id: 'A', count: 2, intervalMin: 15 }] }))
    expect(later.placements[0].placed && local(later.placements[0].start)).toBe('2026-10-12 10:31')
    const tight = distributeContainers(base({ fromDate: '2027-01-10', containers: [{ id: 'A', count: 2, intervalMin: 15 }] }))
    expect(tight.placements[0]).toMatchObject({ placed: false, reason: 'Sem janela livre até o limite de agendamento.' })
  })
})

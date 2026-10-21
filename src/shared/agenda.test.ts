import { describe, expect, it } from 'vitest'
import { agendaDays, agendaRange, shiftAnchor, layoutDay, localDate } from './agenda'

const SP = 'America/Sao_Paulo', NY = 'America/New_York'
const at = (iso: string) => Date.parse(iso)

describe('agenda ranges', () => {
  it('day, Sunday-first week, timeline and a 6-week month grid', () => {
    expect(agendaDays('day', '2026-10-14')).toEqual(['2026-10-14'])
    expect(agendaDays('week', '2026-10-14')).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'])
    expect(agendaDays('timeline', '2026-10-14')).toEqual(agendaDays('week', '2026-10-14'))
    const month = agendaDays('month', '2026-10-14')
    expect([month.length, month[0], month[41]]).toEqual([42, '2026-09-27', '2026-11-07'])
  })

  it('ranges are local midnights in the workspace zone; navigation moves by the view unit', () => {
    expect(agendaRange('day', '2026-10-14', SP)).toMatchObject({ from: '2026-10-14T03:00:00.000Z', to: '2026-10-15T03:00:00.000Z' })
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01')
    expect(shiftAnchor('week', '2026-10-14', 1)).toBe('2026-10-21')
    expect(shiftAnchor('day', '2026-12-31', 1)).toBe('2027-01-01')
    expect(localDate(at('2026-10-15T02:30:00Z'), SP)).toBe('2026-10-14')
  })
})

describe('day layout', () => {
  it('places a 13:00→15:45 Container by real time; DST days have 23 or 25 hours', () => {
    const [b] = layoutDay([{ id: 'a', start: at('2026-10-14T16:00:00Z'), end: at('2026-10-14T18:45:00Z') }], '2026-10-14', SP)
    expect([b.top, b.height]).toEqual([13 / 24, 2.75 / 24])
    // New York 2026-03-08 has 23 h: 12:00 local is 11 real hours after midnight.
    const [spring] = layoutDay([{ id: 's', start: at('2026-03-08T16:00:00Z'), end: at('2026-03-08T17:00:00Z') }], '2026-03-08', NY)
    expect([spring.top, spring.height]).toEqual([11 / 23, 1 / 23])
    const [fall] = layoutDay([{ id: 'f', start: at('2026-11-01T17:00:00Z'), end: at('2026-11-01T18:00:00Z') }], '2026-11-01', NY)
    expect([fall.top, fall.height]).toEqual([13 / 25, 1 / 25])
  })

  it('a Container crossing midnight is clipped on each day and marked as continuing', () => {
    const block = { id: 'n', start: at('2026-10-15T01:00:00Z'), end: at('2026-10-15T04:00:00Z') } // 22:00 → 01:00 local
    const [first] = layoutDay([block], '2026-10-14', SP), [second] = layoutDay([block], '2026-10-15', SP)
    expect(first).toMatchObject({ top: 22 / 24, clippedEnd: true, clippedStart: false })
    expect(second).toMatchObject({ top: 0, height: 1 / 24, clippedStart: true, clippedEnd: false })
    expect(layoutDay([block], '2026-10-16', SP)).toEqual([])
  })

  it('overlapping Containers share lanes; isolated ones keep full width; tiny ones get a minimum height', () => {
    const blocks = [
      { id: 'a', start: at('2026-10-14T12:00:00Z'), end: at('2026-10-14T14:00:00Z') },
      { id: 'b', start: at('2026-10-14T13:00:00Z'), end: at('2026-10-14T15:00:00Z') },
      { id: 'c', start: at('2026-10-14T20:00:00Z'), end: at('2026-10-14T20:00:00Z') }]
    const out = Object.fromEntries(layoutDay(blocks, '2026-10-14', SP).map(b => [b.id, b]))
    expect([out.a.lane, out.b.lane, out.a.lanes, out.b.lanes]).toEqual([0, 1, 2, 2])
    expect([out.c.lane, out.c.lanes, out.c.height]).toEqual([0, 1, 0.02])
  })
})

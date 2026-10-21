import { zonedToUtc } from './schedule'

/**
 * Agenda geometry (PR 08): ranges per view and block placement in the workspace's IANA time zone.
 * Day bounds come from local midnights, so DST days have 23 or 25 hours and blocks stay truthful.
 */
export type AgendaView = 'day' | 'week' | 'month' | 'timeline'
const pad = (n: number) => String(n).padStart(2, '0')
export function localDate(ms: number, timeZone: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
export function addDays(date: string, n: number): string { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10) }
const weekday = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
export const dayStart = (date: string, timeZone: string) => zonedToUtc(date, '00:00', timeZone).getTime()

/** Weeks start on Sunday, like the app's date picker. Timeline covers the same week. */
export function agendaDays(view: AgendaView, anchor: string): string[] {
  if (view === 'day') return [anchor]
  if (view === 'week' || view === 'timeline') { const first = addDays(anchor, -weekday(anchor)); return Array.from({ length: 7 }, (_, i) => addDays(first, i)) }
  const firstOfMonth = `${anchor.slice(0, 7)}-01`, first = addDays(firstOfMonth, -weekday(firstOfMonth))
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}
export function agendaRange(view: AgendaView, anchor: string, timeZone: string) {
  const days = agendaDays(view, anchor)
  return { days, from: new Date(dayStart(days[0], timeZone)).toISOString(), to: new Date(dayStart(addDays(days[days.length - 1], 1), timeZone)).toISOString() }
}
export function shiftAnchor(view: AgendaView, anchor: string, step: number): string {
  if (view === 'day') return addDays(anchor, step)
  if (view === 'week' || view === 'timeline') return addDays(anchor, 7 * step)
  const [y, m] = anchor.split('-').map(Number), month = new Date(Date.UTC(y, m - 1 + step, 1))
  return `${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1)}-01`
}

export interface AgendaBlockInput { id: string; start: number; end: number }
export interface AgendaBlock { id: string; top: number; height: number; lane: number; lanes: number; clippedStart: boolean; clippedEnd: boolean }
/**
 * Vertical placement inside one local day, as fractions of the day's real length. Overlapping blocks share
 * the width in lanes. A minimum visual height keeps short Containers clickable without moving their times.
 */
export function layoutDay(blocks: AgendaBlockInput[], date: string, timeZone: string, minHeight = 0.02): AgendaBlock[] {
  const from = dayStart(date, timeZone), to = dayStart(addDays(date, 1), timeZone), length = to - from
  const visible = blocks.filter(b => b.start < to && Math.max(b.end, b.start) >= from).sort((a, b) => a.start - b.start || b.end - a.end)
  const laneEnds: number[] = [], placed: (AgendaBlock & { s: number; e: number })[] = []
  for (const b of visible) {
    const s = Math.max(b.start, from), e = Math.min(Math.max(b.end, b.start), to)
    const top = (s - from) / length, height = Math.max(minHeight, (e - s) / length)
    const visualEnd = from + (top + height) * length
    let lane = laneEnds.findIndex(end => end <= s)
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(visualEnd) } else laneEnds[lane] = visualEnd
    placed.push({ id: b.id, top, height: Math.min(height, 1 - top), lane, lanes: 1, clippedStart: b.start < from, clippedEnd: b.end > to, s, e: visualEnd })
  }
  // Lanes count per overlapping cluster, so isolated blocks keep the full width.
  for (const p of placed) p.lanes = Math.max(...placed.filter(q => q.s < p.e && p.s < q.e).map(q => q.lane)) + 1
  return placed.map(({ s: _s, e: _e, ...rest }) => rest)
}

export type AgendaItem = import('./publication-containers').PublicationContainer & { username: string | null }
export interface AgendaResult { timeZone: string; truncated: boolean; items: AgendaItem[] }

import { AppError } from './errors'

export interface PlanInput {
  count: number
  startDate: string
  endDate?: string
  timeZone: string
  windows: { start: string; end: string }[]
  weekdays: number[]
  minIntervalMin: number
  maxPerDay: number
  now: Date
}
export interface PlanResult { slots: string[]; unplaced: number }

const MIN = 60_000
const DAY = 86_400_000
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    fmtCache.set(timeZone, f)
  }
  return f
}

function localParts(utcMs: number, timeZone: string) {
  const p = Object.fromEntries(fmt(timeZone).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

export function tzOffsetMs(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000
}

function parseDate(date: string) {
  const [y, mo, d] = date.split('-').map(Number)
  return { y, mo, d }
}

function matches(utcMs: number, timeZone: string, wall: number): boolean {
  return utcMs + tzOffsetMs(utcMs, timeZone) === wall
}

export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const { y, mo, d } = parseDate(date)
  const [h, mi] = time.split(':').map(Number)
  let wall = Date.UTC(y, mo - 1, d, h, mi)
  for (let i = 0; i < 24 * 60; i++) {
    const candidates = [wall - tzOffsetMs(wall - 12 * 3_600_000, timeZone), wall - tzOffsetMs(wall + 12 * 3_600_000, timeZone)]
      .filter((c) => matches(c, timeZone, wall))
    if (candidates.length) return new Date(Math.min(...candidates))
    wall += MIN
  }
  throw new Error(`Não foi possível converter ${date} ${time} em ${timeZone}`)
}

function addDays(date: string, n: number): string {
  const { y, mo, d } = parseDate(date)
  return new Date(Date.UTC(y, mo - 1, d) + n * DAY).toISOString().slice(0, 10)
}

function weekday(date: string): number {
  const { y, mo, d } = parseDate(date)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export interface WindowOccurrence { index: number; date: string; start: number; end: number }
/**
 * Concrete UTC bounds of each daily window between two local dates, in chronological order.
 * `end <= start` crosses midnight and belongs to the start day. Nonexistent wall times (DST gap)
 * advance to the next valid minute, as zonedToUtc does.
 */
export function windowOccurrences(windows: { start: string; end: string; weekdays: number[] }[], timeZone: string, fromDate: string, toDate: string): WindowOccurrence[] {
  const result: WindowOccurrence[] = []
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const day = weekday(date)
    windows.forEach((w, index) => {
      if (!w.weekdays.includes(day)) return
      const crosses = toMinutes(w.end) <= toMinutes(w.start)
      const start = zonedToUtc(date, w.start, timeZone).getTime(), end = zonedToUtc(crosses ? addDays(date, 1) : date, w.end, timeZone).getTime()
      if (end > start) result.push({ index, date, start, end })
    })
  }
  return result.sort((a, b) => a.start - b.start || a.index - b.index)
}

export function planSlots(input: PlanInput): PlanResult {
  if (!(input.minIntervalMin >= 1)) throw new AppError('invalid_input', 'O intervalo mínimo precisa ser de pelo menos 1 minuto.')
  if (!(input.maxPerDay >= 1)) throw new AppError('invalid_input', 'O máximo por dia precisa ser pelo menos 1.')
  const slots: string[] = [], perDay = new Map<string, number>()
  const gap = input.minIntervalMin * MIN
  let last = -Infinity
  // Same occurrences as the peak-window planner: midnight-crossing windows count for the day they start.
  for (const o of windowOccurrences(input.windows.map(w => ({ ...w, weekdays: input.weekdays })), input.timeZone, input.startDate, input.endDate ?? addDays(input.startDate, 365))) {
    for (let utc = o.start; utc < o.end && slots.length < input.count; utc += gap) {
      if ((perDay.get(o.date) ?? 0) >= input.maxPerDay) break
      if (utc < input.now.getTime() || utc < last + gap) continue
      slots.push(new Date(utc).toISOString()); last = utc
      perDay.set(o.date, (perDay.get(o.date) ?? 0) + 1)
    }
    if (slots.length >= input.count) break
  }
  return { slots, unplaced: input.count - slots.length }
}

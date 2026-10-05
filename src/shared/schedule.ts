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

function fromMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function planSlots(input: PlanInput): PlanResult {
  if (!(input.minIntervalMin >= 1)) throw new AppError('invalid_input', 'O intervalo mínimo precisa ser de pelo menos 1 minuto.')
  if (!(input.maxPerDay >= 1)) throw new AppError('invalid_input', 'O máximo por dia precisa ser pelo menos 1.')
  const slots: string[] = []
  const lastDate = input.endDate ?? addDays(input.startDate, 365)
  let last = -Infinity
  for (let date = input.startDate; date <= lastDate && slots.length < input.count; date = addDays(date, 1)) {
    if (!input.weekdays.includes(weekday(date))) continue
    let perDay = 0
    for (const w of input.windows) {
      for (let m = toMinutes(w.start); m < toMinutes(w.end); m += input.minIntervalMin) {
        if (perDay >= input.maxPerDay || slots.length >= input.count) break
        const utc = zonedToUtc(date, fromMinutes(m), input.timeZone).getTime()
        if (utc < input.now.getTime() || utc < last + input.minIntervalMin * MIN) continue
        slots.push(new Date(utc).toISOString())
        last = utc
        perDay++
      }
    }
  }
  return { slots, unplaced: input.count - slots.length }
}

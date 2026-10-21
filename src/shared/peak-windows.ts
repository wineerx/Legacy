import { z } from 'zod'
import { zonedToUtc, windowOccurrences } from './schedule'
export { windowOccurrences, type WindowOccurrence } from './schedule'
import { projectQuota, type QuotaInput, type QuotaProjection } from './quota'

/**
 * Peak windows: wall-clock ranges in the workspace's IANA time zone, configured by the user.
 * There are no built-in windows. A window whose end is not after its start crosses midnight and
 * belongs to the day it starts on (its weekdays refer to that day).
 */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.')
export const peakWindow = z.object({
  start: hhmm, end: hhmm,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha pelo menos um dia.').max(7)
}).strict().refine(w => w.start !== w.end, 'Início e fim precisam ser diferentes.').refine(w => new Set(w.weekdays).size === w.weekdays.length, 'Dias repetidos.')
export type PeakWindow = z.infer<typeof peakWindow>
export const peakWindows = z.array(peakWindow).max(12, 'Use até 12 janelas.').superRefine((list, ctx) => {
  const overlap = findOverlap(list)
  if (overlap) ctx.addIssue({ code: 'custom', message: `As janelas ${overlap[0] + 1} e ${overlap[1] + 1} se sobrepõem.` })
})

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const WEEK = 7 * 1440
/** Week-minute ranges of a window, wrapping Saturday night into Sunday. */
function weekRanges(w: PeakWindow): [number, number][] {
  const s = minutes(w.start), e = minutes(w.end), length = e > s ? e - s : e + 1440 - s
  return w.weekdays.flatMap(day => {
    const start = day * 1440 + s, end = start + length
    return end <= WEEK ? [[start, end]] : [[start, WEEK], [0, end - WEEK]] as [number, number][]
  })
}
export function findOverlap(list: PeakWindow[]): [number, number] | null {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    for (const [a1, a2] of weekRanges(list[i])) for (const [b1, b2] of weekRanges(list[j])) if (a1 < b2 && b1 < a2) return [i, j]
  return null
}

const addDays = (date: string, n: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10) }

export interface DistributionContainer { id: string; count: number; intervalMin: number }
export interface DistributionInput {
  containers: DistributionContainer[]
  windows: PeakWindow[]
  timeZone: string
  fromDate: string
  now: string
  /** Publication times already reserved for this account (any Container, legacy jobs). */
  reserved: { start: string; end: string }[]
  /** Last day (local) a publication may happen; the existing 90-day scheduling limit. */
  horizonDays: number
  /** PR 05 inputs; pending items are the account's existing reservations. */
  quota: Omit<QuotaInput, 'now'>
}
export type DistributionPlacement =
  | { id: string; placed: true; start: string; end: string; slots: string[]; window: number; date: string }
  | { id: string; placed: false; reason: string }
export interface DistributionResult { placements: DistributionPlacement[]; quota: QuotaProjection; peakInWindow: number | null }
export type PlannedContainer = DistributionPlacement & { name: string; count: number; intervalMin: number; revision: number }
export interface DistributionPlan {
  accountId: string; timeZone: string; fromDate: string; windows: PeakWindow[]
  placements: PlannedContainer[]
  quota: QuotaProjection
  /** Most publications inside any provider window along the plan, including existing reservations. */
  peakInWindow: number | null
}

/**
 * Places each Container, in the given order, at the earliest start inside a peak window where:
 * the whole sequence fits before the window ends (no splitting, interval unchanged), it keeps at
 * least its own interval from every reservation of the account, and — when quota is known —
 * no publication goes over the provider's limit. Existing reservations are never moved.
 */
export function distributeContainers(input: DistributionInput): DistributionResult {
  // Never before the chosen local date nor less than a minute from now. A window that started the
  // previous evening and crosses midnight can still host the part after midnight.
  const earliest = Math.max(Date.parse(input.now) + 60_000, zonedToUtc(input.fromDate, '00:00', input.timeZone).getTime())
  const horizon = Date.parse(input.now) + input.horizonDays * 86_400_000
  const occurrences = windowOccurrences(input.windows, input.timeZone, addDays(input.fromDate, -1), addDays(input.fromDate, input.horizonDays)).filter(o => o.end > earliest)
  const busy = input.reserved.map(r => [Date.parse(r.start), Date.parse(r.end)] as [number, number])
  const candidates: { at: string; candidate: true }[] = []
  const quotaFits = (slots: number[]) => {
    const projection = projectQuota({ ...input.quota, now: input.now, pending: [...input.quota.pending, ...candidates, ...slots.map(t => ({ at: new Date(t).toISOString(), candidate: true }))] })
    return projection.status !== 'known' || projection.overLimit === 0
  }
  const placements: DistributionPlacement[] = []
  for (const c of input.containers) {
    const gap = c.intervalMin * 60_000, length = (c.count - 1) * gap
    let placed: DistributionPlacement | null = null, fitsSomeWindow = false, quotaBlocked = false
    for (const o of occurrences) {
      if (o.end - o.start < length) continue
      fitsSomeWindow = true
      // Candidate starts: the window start, or right after a reservation inside it.
      const starts = [o.start, ...busy.map(([, end]) => end + gap)].map(t => Math.max(t, earliest, o.start)).map(t => Math.ceil(t / 60_000) * 60_000)
        .filter((t, i, all) => all.indexOf(t) === i).sort((a, b) => a - b)
      for (const start of starts) {
        const end = start + length
        if (end > o.end || end > horizon) continue
        if (busy.some(([a, b]) => start < b + gap && a < end + gap)) continue
        const slots = Array.from({ length: c.count }, (_, i) => start + i * gap)
        if (!quotaFits(slots)) { quotaBlocked = true; continue }
        placed = { id: c.id, placed: true, start: new Date(start).toISOString(), end: new Date(end).toISOString(), slots: slots.map(t => new Date(t).toISOString()), window: o.index, date: o.date }
        busy.push([start, end]); candidates.push(...placed.slots.map(at => ({ at, candidate: true as const })))
        break
      }
      if (placed) break
    }
    placements.push(placed ?? { id: c.id, placed: false, reason: !fitsSomeWindow
      ? `A sequência de ${c.count} vídeo(s) a cada ${c.intervalMin} min não cabe em nenhuma janela.`
      : quotaBlocked ? 'A quota informada pela Meta não comporta este Container nas janelas disponíveis.' : 'Sem janela livre até o limite de agendamento.' })
  }
  const quota = projectQuota({ ...input.quota, now: input.now, pending: [...input.quota.pending, ...candidates] })
  return { placements, quota, peakInWindow: quota.status === 'known' && quota.slots.length ? Math.max(...quota.slots.map(s => s.inWindow)) : null }
}

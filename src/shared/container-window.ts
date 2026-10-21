import type { JobState } from './types'
import { quotaTimeline, firstQuotaFit, type QuotaInput } from './quota'
import { distributeContainers, type PeakWindow } from './peak-windows'

/**
 * Container window (PR 07): planned start/end versus the current estimate, delay, and adjustment proposals.
 * run_at alone is not an estimate (it also means polling/backoff): items already started remotely are
 * treated as "now"; fresh items use their run_at (which includes quota deferrals), never before now.
 */
export const MIN_INTERVAL_MIN = 15
const MIN = 60_000

export interface WindowItem { jobId: string; position: number; state: JobState; confirmed: boolean; runAt: string; remote: boolean }
export interface WindowInput {
  plannedStartAt: string | null; plannedEndAt: string | null; intervalMin: number
  control: 'active' | 'paused' | 'cancelled'; scheduled: boolean
  now: string
  items: WindowItem[]
  /** PR 05 inputs for the account; `others` are pending publications of other Containers or legacy jobs. */
  quota: Omit<QuotaInput, 'pending' | 'now'> & { others: { at: string }[] }
}
export type WindowStatus = 'not_scheduled' | 'on_time' | 'late' | 'paused' | 'finished' | 'cancelled'
export interface ContainerWindow {
  status: WindowStatus
  plannedStartAt: string | null; plannedEndAt: string | null; intervalMin: number
  estimatedEndAt: string | null; delayMin: number | null
  published: number; remaining: number; inFlight: number; failed: number
  /** Fresh items whose run_at already passed (app closed, worker paused or waiting). */
  overdue: number
  quotaConsidered: boolean
  estimate: { jobId: string; at: string }[]
}

const fresh = (i: WindowItem) => !i.confirmed && i.state === 'queued' && !i.remote
const open = (i: WindowItem) => !i.confirmed && (i.state === 'running' || (i.state === 'queued' && i.remote))

/** Places times in order, each no earlier than its base nor the previous one, and within quota when known. */
export function place(bases: number[], input: WindowInput, inFlight: number[], minGapMs = 0) {
  const now = Date.parse(input.now)
  const timeline = quotaTimeline({ ...input.quota, now: input.now })
  const placed = timeline ? [...timeline.fixed, ...input.quota.others.map(o => Math.max(now, Date.parse(o.at))), ...inFlight] : []
  const out: number[] = []
  for (const base of bases) {
    let t = Math.max(base, now, out.length ? out[out.length - 1] + minGapMs : -Infinity)
    if (timeline) { t = firstQuotaFit(placed, t, timeline.limit, timeline.windowMs); placed.push(t) }
    out.push(t)
  }
  return { times: out, quotaConsidered: Boolean(timeline) }
}

export function estimateWindow(input: WindowInput): ContainerWindow {
  const items = [...input.items].sort((a, b) => a.position - b.position)
  const published = items.filter(i => i.confirmed).length, failed = items.filter(i => !i.confirmed && ['failed', 'cancelled'].includes(i.state)).length
  const remainingItems = items.filter(i => fresh(i) || open(i)), now = Date.parse(input.now)
  const base: Omit<ContainerWindow, 'status' | 'estimatedEndAt' | 'delayMin' | 'quotaConsidered' | 'estimate'> = {
    plannedStartAt: input.plannedStartAt, plannedEndAt: input.plannedEndAt, intervalMin: input.intervalMin,
    published, remaining: remainingItems.length, inFlight: remainingItems.filter(open).length, failed,
    overdue: remainingItems.filter(i => fresh(i) && Date.parse(i.runAt) < now - MIN).length }
  if (!input.scheduled) return { ...base, status: 'not_scheduled', estimatedEndAt: null, delayMin: null, quotaConsidered: false, estimate: [] }
  if (input.control === 'cancelled') return { ...base, status: 'cancelled', estimatedEndAt: null, delayMin: null, quotaConsidered: false, estimate: [] }
  if (!remainingItems.length) return { ...base, status: 'finished', estimatedEndAt: null, delayMin: null, quotaConsidered: false, estimate: [] }
  // A pause has no end: the estimate is suspended rather than invented.
  if (input.control === 'paused') return { ...base, status: 'paused', estimatedEndAt: null, delayMin: null, quotaConsidered: false, estimate: [] }
  const inFlight = remainingItems.filter(open).map(() => now)
  const freshItems = remainingItems.filter(fresh)
  const { times, quotaConsidered } = place(freshItems.map(i => Date.parse(i.runAt)), input, inFlight)
  const estimate = [...remainingItems.filter(open).map(i => ({ jobId: i.jobId, at: input.now })), ...freshItems.map((i, k) => ({ jobId: i.jobId, at: new Date(times[k]).toISOString() }))]
  const end = Math.max(...estimate.map(e => Date.parse(e.at)))
  const delayMin = input.plannedEndAt ? Math.max(0, Math.ceil((end - Date.parse(input.plannedEndAt)) / MIN)) : null
  return { ...base, status: delayMin ? 'late' : 'on_time', estimatedEndAt: new Date(end).toISOString(), delayMin, quotaConsidered, estimate }
}

export type Proposal =
  | { kind: 'keep'; estimatedEndAt: string; delayMin: number }
  | { kind: 'reduce'; intervalMin: number; slots: { jobId: string; at: string }[]; estimatedEndAt: string; delayMin: number }
  | { kind: 'move'; slots: { jobId: string; at: string }[]; startAt: string; estimatedEndAt: string; window: PeakWindow }
export interface ProposalSet { proposals: Proposal[]; unavailable: { kind: 'reduce' | 'move'; reason: string }[] }
export interface MoveContext { windows: PeakWindow[]; timeZone: string; fromDate: string; reserved: { start: string; end: string }[]; horizonDays: number }

/** Proposals only for a late, active Container; they touch fresh items only and never run without a choice. */
export function proposeAdjustments(input: WindowInput, window: ContainerWindow, move: MoveContext): ProposalSet {
  if (window.status !== 'late' || !window.estimatedEndAt) return { proposals: [], unavailable: [] }
  const now = Date.parse(input.now), plannedEnd = Date.parse(input.plannedEndAt!)
  const movable = [...input.items].sort((a, b) => a.position - b.position).filter(fresh)
  const proposals: Proposal[] = [{ kind: 'keep', estimatedEndAt: window.estimatedEndAt, delayMin: window.delayMin! }]
  const unavailable: ProposalSet['unavailable'] = []
  const inFlight = input.items.filter(open).map(() => now)
  const delay = (end: number) => Math.max(0, Math.ceil((end - plannedEnd) / MIN))
  if (movable.length < 2) unavailable.push({ kind: 'reduce', reason: 'Resta só um vídeo a enviar; não há intervalo para reduzir.' })
  else {
    // The first remaining send keeps its time (or one minute from now); the rest compress toward the planned end.
    const first = Math.max(Date.parse(movable[0].runAt), now + MIN)
    const fitting = Math.floor((plannedEnd - first) / (movable.length - 1) / MIN)
    const interval = Math.max(MIN_INTERVAL_MIN, fitting)
    if (input.intervalMin <= MIN_INTERVAL_MIN) unavailable.push({ kind: 'reduce', reason: `O intervalo já está no mínimo de ${MIN_INTERVAL_MIN} min.` })
    else if (interval >= input.intervalMin) unavailable.push({ kind: 'reduce', reason: 'O atraso não vem do intervalo; reduzi-lo não antecipa o término.' })
    else {
      const { times } = place(movable.map((_, k) => first + k * interval * MIN), input, inFlight, interval * MIN)
      const end = Math.max(times[times.length - 1], ...inFlight)
      if (end >= Date.parse(window.estimatedEndAt)) unavailable.push({ kind: 'reduce', reason: 'Reduzir o intervalo não antecipa o término com a quota informada.' })
      else proposals.push({ kind: 'reduce', intervalMin: interval, slots: movable.map((i, k) => ({ jobId: i.jobId, at: new Date(times[k]).toISOString() })), estimatedEndAt: new Date(end).toISOString(), delayMin: delay(end) })
    }
  }
  if (!move.windows.length) unavailable.push({ kind: 'move', reason: 'Configure janelas de pico para mover o restante.' })
  else {
    const plan = distributeContainers({ containers: [{ id: 'remaining', count: movable.length, intervalMin: input.intervalMin }], windows: move.windows, timeZone: move.timeZone,
      fromDate: move.fromDate, now: input.now, reserved: move.reserved, horizonDays: move.horizonDays, quota: { ...input.quota, pending: input.quota.others } })
    const p = plan.placements[0]
    if (!movable.length || !p.placed) unavailable.push({ kind: 'move', reason: p && !p.placed ? p.reason : 'Nenhum vídeo restante pode ser movido.' })
    else proposals.push({ kind: 'move', slots: movable.map((i, k) => ({ jobId: i.jobId, at: p.slots[k] })), startAt: p.start, estimatedEndAt: new Date(Math.max(Date.parse(p.end), ...inFlight)).toISOString(), window: move.windows[p.window] })
  }
  return { proposals, unavailable }
}

export interface AdjustmentState { intervalMin: number; plannedStartAt?: string | null; plannedEndAt: string | null; delayMin: number | null; slots?: { jobId: string; at: string }[] }
export interface AdjustmentView { id: string; kind: 'keep' | 'reduce' | 'move' | 'drag'; createdAt: string; before: AdjustmentState; after: AdjustmentState }
export interface ContainerWindowView {
  containerId: string; revision: number; timeZone: string
  window: ContainerWindow
  proposals: ProposalSet
  quota: { total: number | null; available: number | null; fetchedAt: string | null; freshness: 'fresh' | 'stale' | 'missing' }
  adjustments: AdjustmentView[]
}

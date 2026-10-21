import { place, type WindowInput } from './container-window'
import { windowOccurrences, type PeakWindow } from './peak-windows'
import { addDays } from './agenda'

/**
 * Drag & drop on the Agenda (PR 10): moving a scheduled Container shifts its planned window by the same
 * delta. Only fresh items move (no remote checkpoint, still queued); each keeps its place in the plan
 * (planned time + delta) and is then re-placed with the PR 05 quota rules, so the preview shows exactly
 * what applying will write. Published, in-flight and failed items never change.
 */
const MIN = 60_000
export const DRAG_STEP_MIN = 15

export interface DragInput {
  window: WindowInput
  /** planned_publish_at per job; falls back to run_at when the item has none. */
  planned: Record<string, string | null>
  targetStartAt: string
  /** Pending spans of other Containers and legacy jobs of the same account (PR 06 `occupied`). */
  reserved: { start: string; end: string }[]
  peak: { windows: PeakWindow[]; timeZone: string }
}
export interface DragPreview {
  before: { startAt: string | null; endAt: string | null }
  after: { startAt: string; endAt: string | null; estimatedEndAt: string | null }
  deltaMin: number
  slots: { jobId: string; at: string; before: string }[]
  /** Items that stay as they are: published, being sent or finished with failure. */
  unchanged: { published: number; inFlight: number; failed: number }
  quotaConsidered: boolean
  /** Fresh items the quota pushed later than their place in the plan. */
  quotaDeferred: number
  delayMin: number | null
  conflicts: { start: string; end: string }[]
  /** null when no peak window is configured. */
  insidePeak: boolean | null
  blocked: string | null
}

const fresh = (i: WindowInput['items'][number]) => !i.confirmed && i.state === 'queued' && !i.remote
const open = (i: WindowInput['items'][number]) => !i.confirmed && (i.state === 'running' || (i.state === 'queued' && i.remote))

export function previewDrag(d: DragInput): DragPreview {
  const w = d.window, now = Date.parse(w.now), target = Date.parse(d.targetStartAt)
  const items = [...w.items].sort((a, b) => a.position - b.position)
  const movable = items.filter(fresh)
  const plannedAt = (jobId: string, runAt: string) => Date.parse(d.planned[jobId] ?? runAt)
  const origin = w.plannedStartAt ? Date.parse(w.plannedStartAt) : movable.length ? Math.min(...movable.map(i => plannedAt(i.jobId, i.runAt))) : target
  const delta = target - origin
  const shift = (iso: string | null) => iso ? new Date(Date.parse(iso) + delta).toISOString() : null
  const unchanged = { published: items.filter(i => i.confirmed).length, inFlight: items.filter(open).length, failed: items.filter(i => !i.confirmed && ['failed', 'cancelled'].includes(i.state)).length }
  const base = { before: { startAt: w.plannedStartAt, endAt: w.plannedEndAt }, deltaMin: Math.round(delta / MIN), unchanged }
  const empty = (blocked: string): DragPreview => ({ ...base, after: { startAt: new Date(target).toISOString(), endAt: shift(w.plannedEndAt), estimatedEndAt: null }, slots: [], quotaConsidered: false, quotaDeferred: 0, delayMin: null, conflicts: [], insidePeak: null, blocked })
  if (!w.scheduled) return empty('Rascunhos não têm horário publicado. Abra o rascunho para agendar.')
  if (w.control !== 'active') return empty(w.control === 'paused' ? 'Retome o Container antes de mover.' : 'Containers cancelados não podem ser movidos.')
  if (!movable.length) return empty('Nenhum vídeo restante pode ser movido.')
  if (!delta) return empty('O Container já está neste horário.')
  const ideal = movable.map(i => plannedAt(i.jobId, i.runAt) + delta)
  if (ideal[0] < now + MIN) return empty('Escolha um horário no futuro.')
  const inFlight = items.filter(open).map(() => now)
  const { times, quotaConsidered } = place(ideal, w, inFlight)
  const slots = movable.map((i, k) => ({ jobId: i.jobId, at: new Date(times[k]).toISOString(), before: i.runAt }))
  const first = times[0], last = Math.max(...times, ...inFlight)
  const endAt = shift(w.plannedEndAt)
  const delayMin = endAt ? Math.max(0, Math.ceil((last - Date.parse(endAt)) / MIN)) : null
  const conflicts = d.reserved.filter(r => Date.parse(r.start) <= last && first <= Date.parse(r.end))
  let insidePeak: boolean | null = null
  if (d.peak.windows.length) {
    const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: d.peak.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
    const occ = windowOccurrences(d.peak.windows, d.peak.timeZone, addDays(day(first), -1), day(last))
    insidePeak = occ.some(o => o.start <= first && last <= o.end)
  }
  return { ...base, after: { startAt: new Date(target).toISOString(), endAt, estimatedEndAt: new Date(last).toISOString() }, slots, quotaConsidered,
    quotaDeferred: times.filter((t, k) => t > ideal[k]).length, delayMin, conflicts, insidePeak, blocked: null }
}

/** Snaps a wall-clock minute count to the drag grid. */
export const snapMinutes = (minutes: number, step = DRAG_STEP_MIN) => Math.max(0, Math.min(1440 - step, Math.round(minutes / step) * step))

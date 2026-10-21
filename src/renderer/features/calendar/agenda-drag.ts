import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react'
import { zonedToUtc } from '@shared/schedule'
import { snapMinutes, DRAG_STEP_MIN } from '@shared/container-drag'
import type { AgendaItem } from '@shared/agenda'

/** Only Containers that will still send something can move; the rest explain why in the block tooltip. */
export function dragBlockedReason(item: AgendaItem): string | null {
  if (item.state === 'draft') return 'Rascunhos não têm horário publicado.'
  if (item.state === 'paused') return 'Retome o Container para movê-lo.'
  if (item.state === 'scheduled' || item.state === 'in_progress') return null
  return 'Containers finalizados não podem ser movidos.'
}

const pad = (n: number) => String(n).padStart(2, '0')
export function localParts(ms: number, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}
export const atLocal = (date: string, minutes: number, timeZone: string) => zonedToUtc(date, `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`, timeZone).getTime()

type Mode = { kind: 'time'; hourPx: number } | { kind: 'day' }
export type DragState = { item: AgendaItem; target: number | null; day: string | null }

/**
 * Pointer-driven drag for agenda blocks. The pointer must move a few pixels before it counts as a drag,
 * so a plain click still opens the Sheet. Targets snap to 15 min (time grid) or keep the time of day
 * (month grid). The day under the pointer comes from the nearest `[data-agenda-day]` element.
 */
export function useAgendaDrag({ timeZone, mode, onDrop }: { timeZone: string; mode: Mode; onDrop(item: AgendaItem, startAt: number): void }) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const pending = useRef<{ item: AgendaItem; x: number; y: number; grabMin: number; started: boolean } | null>(null)
  const suppressClick = useRef(false)

  const targetAt = (x: number, y: number, item: AgendaItem, grabMin: number) => {
    const cell = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-agenda-day]')
    const day = cell?.dataset.agendaDay
    if (!cell || !day) return { target: null, day: null }
    if (mode.kind === 'day') return { target: atLocal(day, localParts(Date.parse(item.plannedStartAt!), timeZone).minutes, timeZone), day }
    const minutes = snapMinutes((y - cell.getBoundingClientRect().top) / mode.hourPx * 60 - grabMin)
    return { target: atLocal(day, minutes, timeZone), day }
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current
      if (!p) return
      if (!p.started && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return
      p.started = true
      setDrag({ item: p.item, ...targetAt(e.clientX, e.clientY, p.item, p.grabMin) })
    }
    const up = (e: PointerEvent) => {
      const p = pending.current
      pending.current = null
      if (!p?.started) return
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      setDrag(null)
      // Read the drop target from this event, not from the last rendered state, so a fast release is not lost.
      const { target } = targetAt(e.clientX, e.clientY, p.item, p.grabMin)
      if (target !== null && target !== Date.parse(p.item.plannedStartAt!)) onDrop(p.item, target)
    }
    const cancel = (e: KeyboardEvent | globalThis.KeyboardEvent) => { if (e.key === 'Escape' && pending.current) { pending.current = null; setDrag(null) } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', cancel) }
  })

  const bind = (item: AgendaItem) => {
    if (dragBlockedReason(item)) return {}
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return
        let grabMin = 0
        if (mode.kind === 'time') {
          const cell = e.currentTarget.closest<HTMLElement>('[data-agenda-day]'), day = cell?.dataset.agendaDay
          if (cell && day) {
            const pointer = (e.clientY - cell.getBoundingClientRect().top) / mode.hourPx * 60
            const start = Date.parse(item.plannedStartAt!), dayStartMs = atLocal(day, 0, timeZone)
            grabMin = Math.max(0, pointer - Math.max(0, (start - dayStartMs) / 60_000))
          }
        }
        pending.current = { item, x: e.clientX, y: e.clientY, grabMin, started: false }
      },
      // Keyboard alternative to dragging: Alt + arrows move by 15 min (up/down) or one day (left/right).
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (!e.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
        e.preventDefault()
        const start = Date.parse(item.plannedStartAt!), { date, minutes } = localParts(start, timeZone)
        const step = e.key === 'ArrowUp' ? -DRAG_STEP_MIN : e.key === 'ArrowDown' ? DRAG_STEP_MIN : 0
        const days = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const next = new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
        onDrop(item, atLocal(next, Math.max(0, Math.min(1439, minutes + step)), timeZone))
      },
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
      'data-draggable': true
    }
  }
  const clickGuard = (fn: () => void) => () => { if (!suppressClick.current) fn() }
  return { drag, bind, clickGuard }
}

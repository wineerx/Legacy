import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { cx } from './cx'

function savedWidth(key: string, fallback: number, clamp: (n: number) => number) {
  try {
    const raw = localStorage.getItem(key)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? clamp(value) : fallback
  } catch { return fallback }
}

/**
 * Side column with a grip divider: drag, arrows (16 px, 32 with Shift), Home/End for the limits, Enter or
 * double click for the default width. The width applies from 1280 px up and is saved per storage key.
 * On the right side the divider sits on the left edge, so dragging or pressing left widens the column.
 */
export function ResizableAside({ side = 'left', storageKey, label, defaultWidth = 280, min = 240, max = 400, className, asideClassName, id, ariaLabel, children }: {
  side?: 'left' | 'right'; storageKey: string; label: string; defaultWidth?: number; min?: number; max?: number
  className?: string; asideClassName?: string; id?: string; ariaLabel?: string; children: ReactNode
}) {
  const clamp = (width: number) => Math.min(max, Math.max(min, Math.round(width)))
  const [width, setWidth] = useState(() => savedWidth(storageKey, defaultWidth, clamp))
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; width: number; pointerId: number } | null>(null)
  const generatedId = useId()
  const asideId = id ?? generatedId
  const sign = side === 'left' ? 1 : -1
  const persist = (value: number) => {
    setWidth(value)
    try { localStorage.setItem(storageKey, String(value)) } catch { /* Keep the width for this session. */ }
  }
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      const start = gesture.current
      if (!start || start.pointerId !== event.pointerId) return
      setWidth(clamp(start.width + sign * (event.clientX - start.x)))
    }
    const end = (event: PointerEvent) => {
      const start = gesture.current
      if (!start || start.pointerId !== event.pointerId) return
      gesture.current = null
      if (event.type === 'pointercancel') setWidth(start.width); else persist(clamp(start.width + sign * (event.clientX - start.x)))
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      document.body.style.cursor = cursor; document.body.style.userSelect = userSelect
    }
  }, [dragging])

  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
  return <div className={cx('ds-resizable-aside relative min-h-0 shrink-0', className)} style={{ '--aside-width': `${width}px` } as CSSProperties}>
    <aside id={asideId} aria-label={ariaLabel} className={cx('flex h-full min-h-0 w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto', asideClassName)}>
      {children}
    </aside>
    <div role="separator" aria-label={label} aria-orientation="vertical"
      aria-controls={asideId} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
      aria-valuetext={`${width} pixels`} tabIndex={0}
      title="Arraste para ajustar a largura. Use as setas ou dê dois cliques para restaurar."
      className={cx('group absolute inset-y-0 z-10 hidden w-4 touch-none cursor-col-resize items-center justify-center outline-offset-0 xl:flex', side === 'left' ? '-right-2' : '-left-2', dragging && 'select-none')}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.focus()
        gesture.current = { x: event.clientX, width, pointerId: event.pointerId }
        // Track the pointer on the window as well: if the handle loses pointer capture mid-drag
        // (a re-render or another layer taking the pointer), the gesture still ends where the pointer is.
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* window listeners below still track it */ }
        setDragging(true)
      }}
      onDoubleClick={() => persist(defaultWidth)}
      onKeyDown={event => {
        const step = event.shiftKey ? 32 : 16
        const next = { [grow]: clamp(width + step), [shrink]: clamp(width - step), Home: min, End: max, Enter: defaultWidth }[event.key]
        if (next !== undefined) { event.preventDefault(); persist(next) }
      }}>
      <span aria-hidden className={cx('flex h-8 w-3 items-center justify-center rounded-ctl border border-line bg-panel text-dim shadow-sm transition-colors group-hover:bg-raised group-hover:text-fg group-focus-visible:bg-raised group-focus-visible:text-fg', dragging && 'bg-raised text-fg')}>
        <GripVertical size={12} className="shrink-0" />
      </span>
    </div>
  </div>
}

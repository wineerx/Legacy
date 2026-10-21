import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { cx } from '../../components/ui'

const STORAGE_KEY = 'legacy.profiles.sidebarWidth'
const DEFAULT_WIDTH = 280
const MIN_WIDTH = 240
const MAX_WIDTH = 400
const clamp = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

function savedWidth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const value = raw === null ? NaN : Number(raw)
    return Number.isFinite(value) ? clamp(value) : DEFAULT_WIDTH
  } catch { return DEFAULT_WIDTH }
}

export function ProfileSidebar({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(savedWidth)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ x: number; width: number; current: number; pointerId: number } | null>(null)
  const sidebarId = useId()
  const persist = (value: number) => {
    setWidth(value)
    try { localStorage.setItem(STORAGE_KEY, String(value)) } catch { /* Keep the width for this session. */ }
  }
  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      const start = gesture.current
      if (!start || start.pointerId !== event.pointerId) return
      start.current = clamp(start.width + event.clientX - start.x)
      setWidth(start.current)
    }
    const end = (event: PointerEvent) => {
      const start = gesture.current
      if (!start || start.pointerId !== event.pointerId) return
      gesture.current = null
      if (event.type === 'pointercancel') setWidth(start.width); else persist(clamp(start.width + event.clientX - start.x))
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

  return <div className="profiles-sidebar relative min-h-0 w-full shrink-0 border-b border-line xl:h-full xl:border-r xl:border-b-0"
    style={{ '--profiles-sidebar-width': `${width}px` } as CSSProperties}>
    <aside id={sidebarId} className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto p-4">
      {children}
    </aside>
    <div role="separator" aria-label="Ajustar largura da lista de perfis" aria-orientation="vertical"
      aria-controls={sidebarId} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
      aria-valuetext={`${width} pixels`} tabIndex={0}
      title="Arraste para ajustar a largura. Use as setas ou dê dois cliques para restaurar."
      className={cx('group absolute inset-y-0 -right-2 z-10 hidden w-4 touch-none cursor-col-resize items-center justify-center outline-offset-0 xl:flex', dragging && 'select-none')}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        event.currentTarget.focus()
        gesture.current = { x: event.clientX, width, current: width, pointerId: event.pointerId }
        // Track the pointer on the window as well: if the handle loses pointer capture mid-drag
        // (a re-render or another layer taking the pointer), the gesture still ends where the pointer is.
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* window listeners below still track it */ }
        setDragging(true)
      }}
      onDoubleClick={() => persist(DEFAULT_WIDTH)}
      onKeyDown={event => {
        const step = event.shiftKey ? 32 : 16
        const next = { ArrowRight: clamp(width + step), ArrowLeft: clamp(width - step), Home: MIN_WIDTH, End: MAX_WIDTH, Enter: DEFAULT_WIDTH }[event.key]
        if (next !== undefined) { event.preventDefault(); persist(next) }
      }}>
      <span aria-hidden className={cx('flex h-8 w-3 items-center justify-center rounded-ctl border border-line bg-panel text-dim shadow-sm transition-colors group-hover:bg-raised group-hover:text-fg group-focus-visible:bg-raised group-focus-visible:text-fg', dragging && 'bg-raised text-fg')}>
        <GripVertical size={12} className="shrink-0" />
      </span>
    </div>
  </div>
}

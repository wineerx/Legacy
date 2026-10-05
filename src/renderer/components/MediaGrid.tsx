import { useEffect, useRef, type ReactNode } from 'react'
import type { GridItem } from '@shared/types'
import type { Selection } from '../lib/selection'
import { isSelected } from '../lib/selection'
import { MediaCard916 } from './MediaCard916'
import { Skeleton } from './ui'

export function MediaGrid({ items, loading, selection, onToggleSelect, onOpen, renderActions, onEndReached }: {
  items: GridItem[]; loading: boolean; selection: Selection; onToggleSelect(id: string): void
  onOpen?(item: GridItem): void; renderActions?(item: GridItem): ReactNode; onEndReached?(): void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!onEndReached || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => { if (!loading && entries.some((e) => e.isIntersecting)) onEndReached() }, { rootMargin: '600px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [onEndReached, loading, items.length])
  return (
    <div>
      <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))' }}>
        {items.map((it) => (
          <MediaCard916 key={it.id} item={it} selected={isSelected(selection, it.id)} onToggleSelect={onToggleSelect} onOpen={onOpen} actions={renderActions?.(it)} />
        ))}
        {loading && Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="aspect-[9/16]" />)}
      </div>
      <div ref={sentinel} className="h-px" />
    </div>
  )
}

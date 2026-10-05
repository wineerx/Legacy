import type { ReactNode } from 'react'
import { Eye, Heart, MessageCircle, Film } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { formatCompact, formatDuration } from '@shared/format'
import { mediaUrl } from '../lib/api'
import { Tooltip, cx } from './ui'

const LABELS = { views: 'Visualizações', likes: 'Curtidas', comments: 'Comentários' } as const
const ICONS = { views: Eye, likes: Heart, comments: MessageCircle } as const

function Metric({ k, value }: { k: keyof typeof LABELS; value: number | null }) {
  const Icon = ICONS[k]
  const text = formatCompact(value)
  const label = `${LABELS[k]}: ${value === null ? 'indisponível' : text}`
  const node = (
    <span role="img" aria-label={label} tabIndex={value === null ? 0 : undefined} className={cx('flex items-center gap-1 tabular-nums', value === null && 'text-mute')}>
      <Icon size={12} aria-hidden /><span aria-hidden>{text}</span>
    </span>
  )
  return value === null ? <Tooltip content="Indisponível para este post">{node}</Tooltip> : node
}

export function MediaCard916({ item, selected, onToggleSelect, onOpen, actions }: {
  item: GridItem; selected: boolean; onToggleSelect(id: string): void; onOpen?(item: GridItem): void; actions?: ReactNode
}) {
  const title = item.caption?.slice(0, 80) || 'Vídeo sem legenda'
  return (
    <article aria-label={title} style={{ aspectRatio: '9 / 16' }}
      className={cx('group relative overflow-hidden rounded-ctl border bg-raised', selected ? 'border-fg' : 'border-line')}>
      {item.thumbnailPath
        ? <img src={mediaUrl(item.thumbnailPath)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        : <div className="absolute inset-0 flex items-center justify-center text-mute"><Film size={28} aria-hidden /></div>}
      {onOpen && <button type="button" onClick={() => onOpen(item)} className="absolute inset-0" aria-label={`Abrir ${title}`} />}
      <label className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded bg-black/60">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(item.id)} aria-label={`Selecionar ${title}`} className="h-3.5 w-3.5 accent-white" />
      </label>
      <div className="absolute right-2 top-2 z-10 flex flex-wrap justify-end gap-1">
        {item.badges.map((b) => <span key={b} className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-fg">{b}</span>)}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col">
        {actions && <div className="hidden gap-1 px-2 pb-1 group-hover:flex group-focus-within:flex">{actions}</div>}
        {item.durationMs !== null && <span className="mb-1 mr-2 self-end rounded bg-black/70 px-1 text-[11px] tabular-nums">{formatDuration(item.durationMs)}</span>}
        <div className="flex flex-col gap-0.5 bg-black/75 px-2 py-1.5 text-xs text-fg">
          <Metric k="views" value={item.metrics.views} />
          <Metric k="likes" value={item.metrics.likes} />
          <Metric k="comments" value={item.metrics.comments} />
        </div>
      </div>
    </article>
  )
}

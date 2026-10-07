import type { ReactNode } from 'react'
import { Eye, Heart, MessageCircle, Film, Download, PackageCheck, Star, Link2, type LucideIcon } from 'lucide-react'
import type { GridItem } from '@shared/types'
import { formatCompact, formatDuration } from '@shared/format'
import { mediaUrl } from '../lib/api'
import { Tooltip, cx } from './ui'

const LABELS = { views: 'Visualizações', likes: 'Curtidas', comments: 'Comentários' } as const
const ICONS = { views: Eye, likes: Heart, comments: MessageCircle } as const
const STATUS = { ready: 'Pronto', processing: 'Processando', scheduled: 'Agendado', published: 'Publicado', failed: 'Falhou' } as const
// Selos viram ícones com rótulo acessível: o texto completo poluía o card e cobria o checkbox.
const BADGES: [GridItem['badges'][number], LucideIcon, string][] = [
  ['baixado', Download, 'Baixado'], ['link', Link2, 'Somente link'], ['exportado', PackageCheck, 'Exportado'], ['favorito', Star, 'Favorito']
]

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

export function MediaCard916({ item, selected, onToggleSelect, onOpen, actions, showBanner = true }: {
  item: GridItem; selected: boolean; onToggleSelect(id: string): void; onOpen?(item: GridItem): void; actions?: ReactNode; showBanner?: boolean
}) {
  const thumbnail = showBanner ? item.thumbnailPath : item.firstFramePath ?? item.thumbnailPath
  const title = item.caption?.slice(0, 80) || 'Vídeo sem legenda'
  return (
    <article aria-label={title} style={{ aspectRatio: '9 / 16' }}
      onClickCapture={(event) => {
        if (!event.ctrlKey && !event.metaKey) return
        const target = event.target as HTMLElement
        if (target.closest('input, a, button:not([data-media-open]), [role="button"], [role="menuitem"]')) return
        event.preventDefault()
        event.stopPropagation()
        onToggleSelect(item.id)
      }}
      className={cx('group relative overflow-hidden rounded-ctl border bg-raised', selected ? 'border-fg' : 'border-line')}>
      {thumbnail
        ? <img src={mediaUrl(thumbnail)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        : <div className="absolute inset-0 flex items-center justify-center text-mute"><Film size={28} aria-hidden /></div>}
      {onOpen && <button type="button" data-media-open onClick={() => onOpen(item)} className="absolute inset-0" aria-label={`Abrir ${title}`} aria-description="Ctrl + clique para marcar ou desmarcar este vídeo sem abrir o player." />}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(item.id)} aria-label={`Selecionar ${title}`} className="ds-check-media pointer-events-auto m-0" />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {item.sourcePlatform && <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-fg">{item.sourcePlatform === 'tiktok' ? 'TikTok' : 'Instagram'}</span>}
          {item.kind === 'asset' && item.status && <span className={cx('truncate rounded px-1.5 py-0.5 text-[11px] leading-4', item.status === 'failed' ? 'bg-danger/80 text-white' : 'bg-black/70 text-fg')}>{STATUS[item.status]}</span>}
          {BADGES.filter(([b]) => item.badges.includes(b)).map(([b, Icon, label]) => (
            <span key={b} role="img" aria-label={label} title={label} className="pointer-events-auto flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/70 text-fg"><Icon size={12} aria-hidden fill={b === 'favorito' ? 'currentColor' : 'none'} /></span>
          ))}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
        {/* Opacidade em vez de display:none: o gatilho do menu precisa continuar no layout para o popover manter a âncora ao sair do card. */}
        {actions && <div className="pointer-events-auto flex gap-1 px-2 pb-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">{actions}</div>}
        {item.durationMs !== null && <span className="mb-1 mr-2 self-end rounded bg-black/70 px-1 text-[11px] tabular-nums">{formatDuration(item.durationMs)}</span>}
        {item.kind === 'asset' && <div className="bg-black/75 px-2 py-1 text-[11px]"><p className="truncate">{item.sourceProfile ? `@${item.sourceProfile}` : item.caption}</p>{!!item.publishedAccounts?.length && <p className="text-dim">Publicado em {item.publishedAccounts.length} conta(s)</p>}</div>}
        <div data-testid="card-metrics" className="pointer-events-auto flex flex-nowrap items-center justify-between gap-1 bg-black/75 px-1.5 py-1.5 text-[10px] text-fg">
          <Metric k="views" value={item.metrics.views} />
          <Metric k="likes" value={item.metrics.likes} />
          <Metric k="comments" value={item.metrics.comments} />
        </div>
      </div>
    </article>
  )
}

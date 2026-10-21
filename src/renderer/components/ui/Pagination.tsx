import { useEffect } from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cx } from './cx'

/** Page count for a total; at least one page so "Página 1 de 1" stays truthful for small results. */
export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize))

/**
 * One pagination for every list: "1–25 de 120 tarefas", optional page size, "Página 2 de 5" and
 * first/previous/next/last. Pages are 1-based. When the total shrinks (a filter, a deletion) and the
 * current page no longer exists, it moves to the last existing page instead of showing an empty list.
 */
export function Pagination({ page, pageSize, total, onPage, noun = 'itens', pageSizes, onPageSize, label = 'Paginação', compact = false, busy = false, className }: {
  page: number; pageSize: number; total: number; onPage(page: number): void
  noun?: string; pageSizes?: number[]; onPageSize?(size: number): void; label?: string; compact?: boolean; busy?: boolean; className?: string
}) {
  const pages = pageCount(total, pageSize)
  useEffect(() => { if (!busy && total > 0 && page > pages) onPage(pages) }, [busy, total, page, pages, onPage])
  if (total <= 0) return null
  const current = Math.min(page, pages), from = (current - 1) * pageSize + 1, to = Math.min(current * pageSize, total)
  const go = (p: number) => onPage(Math.min(pages, Math.max(1, p)))
  const nav = (p: number, text: string, icon: React.ReactNode, disabled: boolean) =>
    <button type="button" aria-label={text} title={text} disabled={disabled || busy} onClick={() => go(p)} className="ds-page-button">{icon}</button>
  return <nav aria-label={label} className={cx('ds-pagination', compact && 'ds-pagination-compact', className)}>
    <span className="tabular-nums" aria-live="polite">{from.toLocaleString('pt-BR')}–{to.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')} {noun}</span>
    <div className="ml-auto flex flex-wrap items-center gap-3">
      {pageSizes && onPageSize && !compact && <label className="flex items-center gap-2"><span>Por página</span>
        <RadixSelect.Root value={String(pageSize)} onValueChange={v => { onPageSize(Number(v)); onPage(1) }}>
          <RadixSelect.Trigger aria-label="Itens por página" className="ds-page-size"><RadixSelect.Value /><RadixSelect.Icon><ChevronDown size={12} /></RadixSelect.Icon></RadixSelect.Trigger>
          <RadixSelect.Portal><RadixSelect.Content position="popper" sideOffset={4} className="ds-dropdown w-24 min-w-0 p-1">
            <RadixSelect.Viewport>{pageSizes.map(n => <RadixSelect.Item key={n} value={String(n)} className="relative cursor-default rounded-ctl py-1.5 pl-2.5 pr-7 text-xs outline-none data-[highlighted]:bg-raised">
              <RadixSelect.ItemText>{n}</RadixSelect.ItemText><RadixSelect.ItemIndicator className="absolute right-2 top-2"><Check size={12} /></RadixSelect.ItemIndicator></RadixSelect.Item>)}</RadixSelect.Viewport>
          </RadixSelect.Content></RadixSelect.Portal>
        </RadixSelect.Root></label>}
      <span className="tabular-nums">Página {current} de {pages}</span>
      <div className="flex items-center gap-1">
        {!compact && nav(1, 'Primeira página', <ChevronsLeft size={14} aria-hidden />, current === 1)}
        {nav(current - 1, 'Página anterior', <ChevronLeft size={14} aria-hidden />, current === 1)}
        {nav(current + 1, 'Próxima página', <ChevronRight size={14} aria-hidden />, current === pages)}
        {!compact && nav(pages, 'Última página', <ChevronsRight size={14} aria-hidden />, current === pages)}
      </div>
    </div>
  </nav>
}

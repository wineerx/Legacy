import * as Popover from '@radix-ui/react-popover'
import { ArrowDownUp, Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cx } from './cx'
import { ToneDot, type Tone } from './StatusBadge'

/**
 * One filter pattern for every screen:
 * FilterBar  = [search] [facets…] [Filtros · n]                [view/actions]
 * FilterPresets = quick combinations above or below the bar
 * ActiveFilters = result count, removable chips and "Limpar filtros"
 */
export type ActiveFilter = { key: string; label: string; clear(): void }
export type FacetOption = { value: string; label: string; tone?: Tone; count?: number | null; icon?: ReactNode }
export type FilterPreset = { id: string; label: string; icon?: ReactNode; active: boolean; apply(): void }

export function FilterBar({ children, actions, label, className }: { children: ReactNode; actions?: ReactNode; label: string; className?: string }) {
  return <div role="search" aria-label={label} className={cx('ds-filterbar', className)}>
    <div className="ds-filterbar-main">{children}</div>
    {actions && <div className="ds-filterbar-actions">{actions}</div>}
  </div>
}

export function FilterSearch({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange(v: string): void; placeholder?: string; className?: string }) {
  return <div className={cx('ds-filter-search', className)}>
    <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
    <input type="search" aria-label={label} placeholder={placeholder ?? label} value={value} onChange={e => onChange(e.target.value)} />
    {value && <button type="button" aria-label={`Limpar ${label.toLowerCase()}`} onClick={() => onChange('')}><X size={12} aria-hidden /></button>}
  </div>
}

/** Faceted filter: a compact trigger and a checkable list. Single choice closes on pick; multiple keeps the list open. */
export function FacetFilter({ label, icon, options, value, onChange, multiple = false }: { label: string; icon?: ReactNode; options: FacetOption[]; value: string[]; onChange(v: string[]): void; multiple?: boolean }) {
  const [open, setOpen] = useState(false)
  const picked = options.filter(o => value.includes(o.value))
  const summary = !picked.length ? 'Todos' : picked.length === 1 ? picked[0].label : `${picked.length} selecionados`
  const toggle = (v: string) => {
    if (!multiple) { onChange(value.includes(v) ? [] : [v]); setOpen(false); return }
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" aria-label={picked.length ? `${label}: ${summary}` : label} data-active={picked.length > 0 || undefined} className="ds-filter-trigger">
        {icon}<span>{label}</span>
        {picked.length > 0 && <><span aria-hidden className="ds-filter-sep" /><span className="ds-filter-value">{summary}</span></>}
        <ChevronDown size={13} aria-hidden className="text-dim" />
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} className="ds-dropdown ds-facet" aria-label={`Opções de ${label.toLowerCase()}`}>
      <p className="ds-facet-title">{label}</p>
      <div role="listbox" aria-label={label} aria-multiselectable={multiple || undefined} className="grid gap-0.5">
        {options.map(o => { const on = value.includes(o.value)
          return <button key={o.value} type="button" role="option" aria-label={o.label} aria-selected={on} onClick={() => toggle(o.value)} className="ds-facet-option">
            {o.tone ? <ToneDot tone={o.tone} /> : o.icon}
            <span className="min-w-0 flex-1 truncate text-left">{o.label}</span>
            {o.count !== undefined && <span className="tabular-nums text-[11px] text-dim">{o.count ?? '—'}</span>}
            <Check size={14} aria-hidden className={cx('shrink-0', on ? 'opacity-100' : 'opacity-0')} />
          </button> })}
      </div>
      <div className="ds-facet-footer">
        {multiple && <button type="button" onClick={() => onChange(options.map(o => o.value))}>Selecionar todos</button>}
        <button type="button" disabled={!picked.length} onClick={() => onChange([])}>Limpar</button>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

/** "Filtros" button with the count of advanced filters; sections apply live, the footer only closes. */
export function FilterPopover({ count, onReset, children, total, label = 'Filtros', width = 380 }: { count: number; onReset(): void; children: ReactNode; total?: number; label?: string; width?: number }) {
  const [open, setOpen] = useState(false)
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" aria-label={count ? `${label} (${count} ativos)` : label} data-active={count > 0 || undefined} className="ds-filter-trigger">
        <SlidersHorizontal size={13} aria-hidden />{label}{count > 0 && <span className="ds-filter-count">{count}</span>}
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} collisionPadding={12} style={{ width }} className="ds-dropdown ds-filter-panel" aria-label={label}>
      <header className="ds-filter-panel-header"><p className="text-sm font-semibold">{label}</p><button type="button" disabled={!count} onClick={onReset}>Redefinir</button></header>
      <div className="ds-filter-panel-body">{children}</div>
      <footer className="ds-filter-panel-footer"><button type="button" className="ds-filter-apply" onClick={() => setOpen(false)}>{total === undefined ? 'Aplicar' : `Ver ${total.toLocaleString('pt-BR')} resultado(s)`}</button></footer>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="ds-filter-section"><legend>{title}</legend>{children}</fieldset>
}

export function FilterPresets({ presets, label = 'Combinações rápidas' }: { presets: FilterPreset[]; label?: string }) {
  return <div role="group" aria-label={label} className="ds-presets">
    <span className="ds-presets-label">{label}</span>
    {presets.map(p => <button key={p.id} type="button" aria-pressed={p.active} onClick={p.apply} className="ds-chip ds-chip-sm">{p.icon}{p.label}</button>)}
  </div>
}

export function ActiveFilters({ filters, total, onClear, noun = 'resultado(s)' }: { filters: ActiveFilter[]; total?: number | null; onClear(): void; noun?: string }) {
  return <div className="ds-active-filters" aria-live="polite">
    {total !== undefined && <span className="text-dim tabular-nums">{total === null ? '—' : total.toLocaleString('pt-BR')} {noun}</span>}
    {filters.length ? <>
      {total !== undefined && <span aria-hidden className="h-4 w-px bg-line" />}
      {filters.map(f => <button type="button" key={f.key} aria-label={`Remover filtro: ${f.label}`} onClick={f.clear} className="ds-active-chip"><span className="truncate">{f.label}</span><X size={11} aria-hidden className="shrink-0" /></button>)}
      <button type="button" onClick={onClear} className="ds-link-button">Limpar filtros</button>
    </> : <span className="text-dim">Sem filtros aplicados</span>}
  </div>
}

/**
 * "Ordenar: Mais vistos ▾" — field and direction in one menu, so sorting never competes with filters for
 * room in the bar. Each direction is spelled out for the chosen field ("Maior primeiro" means nothing alone).
 */
export function SortMenu<T extends string>({ value, options, onChange, direction, onDirection, label = 'Ordenar' }: {
  value: T; options: { value: T; label: string; directions?: [desc: string, asc: string] }[]; onChange(v: T): void
  direction?: 'asc' | 'desc'; onDirection?(d: 'asc' | 'desc'): void; label?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value) ?? options[0]
  const dirs = current.directions ?? ['Maior primeiro', 'Menor primeiro']
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" aria-label={`${label}: ${current.label}${direction ? `, ${direction === 'desc' ? dirs[0] : dirs[1]}` : ''}`} className="ds-filter-trigger ds-sort-trigger">
        <ArrowDownUp size={13} aria-hidden /><span className="text-dim">{label}:</span><span>{current.label}</span><ChevronDown size={13} aria-hidden className="text-dim" />
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={6} className="ds-dropdown ds-facet" aria-label={`Opções de ${label.toLowerCase()}`}>
      <p className="ds-facet-title">{label} por</p>
      <div role="listbox" aria-label={label} className="grid gap-0.5">
        {options.map(o => <button key={o.value} type="button" role="option" aria-label={o.label} aria-selected={o.value === value} onClick={() => { onChange(o.value); if (!onDirection) setOpen(false) }} className="ds-facet-option">
          <span className="min-w-0 flex-1 truncate text-left">{o.label}</span><Check size={14} aria-hidden className={o.value === value ? 'opacity-100' : 'opacity-0'} />
        </button>)}
      </div>
      {direction && onDirection && <>
        <p className="ds-facet-title mt-1 border-t border-line pt-2">Ordem</p>
        <div role="listbox" aria-label="Ordem" className="grid gap-0.5">
          {(['desc', 'asc'] as const).map((d, i) => <button key={d} type="button" role="option" aria-label={dirs[i]} aria-selected={direction === d} onClick={() => { onDirection(d); setOpen(false) }} className="ds-facet-option">
            <span className="min-w-0 flex-1 truncate text-left">{dirs[i]}</span><Check size={14} aria-hidden className={direction === d ? 'opacity-100' : 'opacity-0'} />
          </button>)}
        </div>
      </>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

/**
 * Selection bar shared by grids: a hint and the selection helpers when nothing is selected; the count and
 * the actions when something is. Disabled action rows without context are avoided.
 */
export function SelectionBar({ count, label, hint, helpers, actions, onClear }: { count: number; label: string; hint: string; helpers?: ReactNode; actions: ReactNode; onClear(): void }) {
  return count > 0
    ? <div role="toolbar" aria-label="Ações da seleção" className="ds-selection-bar">
      <span className="text-sm font-semibold" aria-live="polite">{label}</span>
      <button type="button" onClick={onClear} className="ds-link-button">Limpar</button>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <div className="flex flex-1 flex-wrap items-center gap-2">{actions}</div>
      {helpers && <div className="flex flex-wrap items-center gap-2">{helpers}</div>}
    </div>
    : <div className="ds-selection-hint"><p className="min-w-0 flex-1">{hint}</p>{helpers && <div className="flex flex-wrap items-center gap-2">{helpers}</div>}</div>
}

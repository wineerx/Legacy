import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible'
import { ResizableAside } from './ResizableAside'
import { ToneDot } from './StatusBadge'
import { cx } from './cx'
import type { FacetOption } from './Filters'

/**
 * Filter layout shared by the video grids:
 * a quick bar above the grid (search, dashed fields of the most used groups and of any active group)
 * and a side panel holding every group, collapsible, with counts, a filter search and "Limpar todos".
 * Inside a group of several choices options combine with OR; groups combine with AND.
 */
export type FilterChip = { key: string; label: string; remove(): void }
export type FilterGroupDef = {
  id: string; title: string; chips: FilterChip[]; keywords: string[]; body: ReactNode
  /** Quick groups always have a field in the bar; the others get one while they have a selection. */
  quick?: boolean; field?: ReactNode; defaultOpen?: boolean
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const read = <T,>(key: string): T | undefined => { try { const raw = localStorage.getItem(key); return raw === null ? undefined : JSON.parse(raw) as T } catch { return undefined } }
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Keep it for this session. */ } }
const WIDE = '(min-width: 80rem)'

function useWide() {
  const query = () => typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null
  const [wide, setWide] = useState(() => query()?.matches ?? true)
  useEffect(() => {
    const media = query()
    if (!media) return
    const change = () => setWide(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return wide
}

export type FilterPanelState = ReturnType<typeof useFilterPanel>

/**
 * Open state of the panel and of its groups, saved per screen. Below 1280 px the panel is a drawer that
 * starts closed and is not saved, so entering the screen never covers the grid.
 */
export function useFilterPanel(storageKey: string, defaultOpen: boolean) {
  const wide = useWide()
  const panelId = useId()
  const [docked, setDocked] = useState(() => read<boolean>(`${storageKey}.open`) ?? defaultOpen)
  const [drawer, setDrawer] = useState(false)
  const [groups, setGroups] = useState<Record<string, boolean>>(() => read<Record<string, boolean>>(`${storageKey}.groups`) ?? {})
  const [revealed, setRevealed] = useState<{ id: string; at: number } | null>(null)
  const open = wide ? docked : drawer
  const setOpen = (value: boolean) => {
    if (!wide) { setDrawer(value); return }
    setDocked(value); write(`${storageKey}.open`, value)
  }
  const setGroupOpen = (id: string, value: boolean) => setGroups(previous => { const next = { ...previous, [id]: value }; write(`${storageKey}.groups`, next); return next })
  return {
    panelId, wide, open, setOpen, revealed, setGroupOpen,
    groupOpen: (id: string, fallback: boolean) => groups[id] ?? fallback,
    /** Opens the panel on a group and scrolls to it. */
    reveal: (id: string) => { setOpen(true); setGroupOpen(id, true); setRevealed({ id, at: Date.now() }) }
  }
}

export function FilterToggle({ state, count, label = 'Filtros' }: { state: FilterPanelState; count: number; label?: string }) {
  return <button type="button" aria-pressed={state.open} aria-controls={state.panelId} aria-label={count ? `${label} (${count} ativos)` : label}
    onClick={() => state.setOpen(!state.open)} data-active={count > 0 || undefined} className="ds-filter-trigger ds-filter-toggle">
    <SlidersHorizontal size={13} aria-hidden />{label}{count > 0 && <span className="ds-filter-count">{count}</span>}
  </button>
}

/**
 * Dashed field with the chosen options inside, each removable on its own. With `children` the field opens
 * them in a popover; without, a click calls `onActivate` (used to reveal a group of the side panel).
 */
export function FilterField({ label, chips, children, onActivate, open, onOpenChange }: {
  label: string; chips: FilterChip[]; children?: ReactNode; onActivate?(): void; open?: boolean; onOpenChange?(open: boolean): void
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = open ?? localOpen
  const setIsOpen = (value: boolean) => { if (open === undefined) setLocalOpen(value); onOpenChange?.(value) }
  const summary = chips.length ? `${label}: ${chips.map(c => c.label).join(', ')}` : label
  const triggerContent = <>{chips.length ? null : <Plus size={13} aria-hidden className="text-dim" />}<span>{label}</span><ChevronDown size={13} aria-hidden className="text-dim" /></>
  const field = (trigger: ReactNode) => <div role="group" aria-label={label} data-active={chips.length > 0 || undefined} className="ds-filter-field"
    onClick={event => { if (event.target === event.currentTarget) { if (children) setIsOpen(true); else onActivate?.() } }}>
    {trigger}
    {chips.length > 0 && <span aria-hidden className="ds-filter-sep" />}
    {chips.map(chip => <span key={chip.key} className="ds-filter-token">
      <span className="truncate">{chip.label}</span>
      <button type="button" aria-label={`Remover ${chip.label} de ${label}`} onClick={event => { event.stopPropagation(); chip.remove() }}><X size={11} aria-hidden /></button>
    </span>)}
  </div>
  if (!children) return field(<button type="button" aria-label={summary} className="ds-filter-field-trigger" onClick={onActivate}>{triggerContent}</button>)
  return <Popover.Root open={isOpen} onOpenChange={setIsOpen}>
    <Popover.Anchor asChild>{field(<Popover.Trigger asChild><button type="button" aria-label={summary} className="ds-filter-field-trigger">{triggerContent}</button></Popover.Trigger>)}</Popover.Anchor>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} collisionPadding={12} className="ds-dropdown ds-facet" aria-label={`Escolher ${label.toLowerCase()}`}>
      {children}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

/**
 * Checkboxes (several choices) or radios (one choice). For one choice, an option with value '' stands for
 * "any" and is checked when nothing is chosen. Lists longer than six options get their own search.
 */
export function OptionList({ label, options, value, onChange, multiple = false, searchable }: {
  label: string; options: FacetOption[]; value: string[]; onChange(v: string[]): void; multiple?: boolean; searchable?: boolean
}) {
  const [query, setQuery] = useState('')
  const name = useId()
  const withSearch = searchable ?? options.length > 6
  const shown = query ? options.filter(o => fold(o.label).includes(fold(query))) : options
  const checked = (o: FacetOption) => multiple ? value.includes(o.value) : o.value === '' ? value.length === 0 : value[0] === o.value
  const pick = (o: FacetOption) => multiple
    ? onChange(value.includes(o.value) ? value.filter(v => v !== o.value) : [...value, o.value])
    : onChange(o.value ? [o.value] : [])
  return <div className="grid gap-1.5">
    {withSearch && <div className="ds-filter-search ds-filter-search-block">
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
      <input type="search" className="ds-field" aria-label={`Buscar em ${label.toLowerCase()}`} placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)} />
    </div>}
    <div role="group" aria-label={`Opções de ${label.toLowerCase()}`} className="grid gap-0.5">
      {shown.map(o => <label key={o.value || 'any'} className="ds-option-row">
        <input type={multiple ? 'checkbox' : 'radio'} name={multiple ? undefined : name} checked={checked(o)} onChange={() => pick(o)} aria-label={o.label} />
        {!o.tone && o.icon}
        <span className="min-w-0 flex-1 truncate">{o.label}</span>
        {o.count !== undefined && <span className="tabular-nums text-[11px] text-dim">{o.count === null ? '—' : o.count.toLocaleString('pt-BR')}</span>}
        {o.tone && <ToneDot tone={o.tone} />}
      </label>)}
      {!shown.length && <p className="px-2 py-1.5 text-xs text-dim">Nenhuma opção encontrada</p>}
    </div>
  </div>
}

/** Dashed field that opens an option list; one choice closes on pick. */
export function FacetField({ label, options, value, onChange, multiple = false, searchable, chips: customChips }: {
  label: string; options: FacetOption[]; value: string[]; onChange(v: string[]): void; multiple?: boolean; searchable?: boolean
  /** Replaces the chips built from the options, e.g. a custom date range. */
  chips?: FilterChip[]
}) {
  const [open, setOpen] = useState(false)
  const chips = customChips ?? options.filter(o => o.value && value.includes(o.value)).map(o => ({ key: o.value, label: o.label, remove: () => onChange(value.filter(v => v !== o.value)) }))
  return <FilterField label={label} chips={chips} open={open} onOpenChange={setOpen}>
    <p className="ds-facet-title">{label}</p>
    <OptionList label={label} options={options} value={value} multiple={multiple} searchable={searchable}
      onChange={next => { onChange(next); if (!multiple) setOpen(false) }} />
    <div className="ds-facet-footer"><button type="button" disabled={!value.length} onClick={() => onChange([])}>Limpar</button></div>
  </FilterField>
}

/** Dashed fields of the bar: every quick group, plus each other group while it has a selection. */
export function FilterFields({ state, groups }: { state: FilterPanelState; groups: FilterGroupDef[] }) {
  return <>{groups.map(g => g.quick && g.field
    ? <span key={g.id} className="contents">{g.field}</span>
    : g.chips.length ? <FilterField key={g.id} label={g.title} chips={g.chips} onActivate={() => state.reveal(g.id)} /> : null)}</>
}

function FilterGroup({ group, state, searching }: { group: FilterGroupDef; state: FilterPanelState; searching: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const open = searching || state.groupOpen(group.id, group.defaultOpen ?? true)
  // Closed groups mount their controls on first open; the panel stays light on screens with many groups.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  const revealedAt = state.revealed?.id === group.id ? state.revealed.at : 0
  useEffect(() => {
    if (!revealedAt) return
    ref.current?.scrollIntoView({ block: 'nearest' })
    ref.current?.querySelector<HTMLElement>('.ds-filter-group-trigger')?.focus()
  }, [revealedAt])
  return <Collapsible ref={ref} open={open} onOpenChange={value => !searching && state.setGroupOpen(group.id, value)} className="ds-filter-group">
    <CollapsibleTrigger className="ds-filter-group-trigger" aria-label={group.chips.length > 0 ? `${group.title} (${group.chips.length})` : undefined}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{group.title}</span>
        {group.chips.length > 0 && <span aria-hidden className="ds-filter-badge">{group.chips.length}</span>}
      </span>
      <ChevronDown aria-hidden className="collapsible-chevron" />
    </CollapsibleTrigger>
    <CollapsibleContent bodyClassName="ds-filter-group-body">{mounted ? group.body : null}</CollapsibleContent>
  </Collapsible>
}

/**
 * Side panel with every group: title and "Limpar todos",
 * then each group with its selection count. Docked from 1280 px (on the right by default), a drawer below.
 * `searchable` adds a search over the groups; `plain` drops the panel background, like the profile list.
 */
export function FilterPanel({ state, groups, count, onClearAll, total, noun, storageKey = 'legacy.filters.width', side = 'right', searchable = true, plain = false }: {
  state: FilterPanelState; groups: FilterGroupDef[]; count: number; onClearAll(): void; total?: number | null; noun: string; storageKey?: string
  side?: 'left' | 'right'; searchable?: boolean; plain?: boolean
}) {
  const [query, setQuery] = useState('')
  const drawerRef = useRef<HTMLElement>(null)
  const drawer = state.open && !state.wide
  useEffect(() => {
    if (!drawer) return
    const initialFocus = searchable
      ? drawerRef.current?.querySelector<HTMLElement>('input[type=search]')
      : drawerRef.current?.querySelector<HTMLElement>('[data-filter-drawer-close]')
    initialFocus?.focus()
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) state.setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer, searchable])
  if (!state.open) return null
  const shown = query ? groups.filter(g => fold([g.title, ...g.keywords].join(' ')).includes(fold(query))) : groups
  const content = <>
    <header className="ds-filter-aside-header">
      <h2 className="ds-filter-aside-title">Filtros{count > 0 && <span className="sr-only">{` (${count})`}</span>}</h2>
      <div className="flex items-center gap-1">
        <button type="button" disabled={!count} onClick={onClearAll} className="ds-filter-clear">Limpar todos</button>
        {!state.wide && <button type="button" aria-label="Fechar filtros" data-filter-drawer-close onClick={() => state.setOpen(false)} className="ds-filter-clear"><X size={14} aria-hidden /></button>}
      </div>
    </header>
    {searchable && <div className="ds-filter-search ds-filter-search-block mx-4 mb-2">
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
      <input type="search" className="ds-field" aria-label="Buscar filtros" placeholder="Buscar filtros" value={query} onChange={e => setQuery(e.target.value)} />
    </div>}
    <div className="ds-filter-aside-body">
      {shown.map(g => <FilterGroup key={g.id} group={g} state={state} searching={Boolean(query)} />)}
      {!shown.length && <p className="px-4 py-3 text-xs text-dim">Nenhum filtro encontrado</p>}
    </div>
    {total !== undefined && <footer className="ds-filter-aside-footer" aria-live="polite">{total === null ? '—' : total.toLocaleString('pt-BR')} {noun}</footer>}
  </>
  if (state.wide) return <ResizableAside side={side} id={state.panelId} ariaLabel="Filtros" storageKey={storageKey} label="Ajustar largura dos filtros"
    className={cx('ds-filter-aside h-full border-line', side === 'left' ? 'border-r' : 'border-l', plain && 'ds-filter-aside-plain')} asideClassName={plain ? undefined : 'bg-panel'}>{content}</ResizableAside>
  return <>
    <button type="button" aria-label="Fechar filtros" tabIndex={-1} className="fixed inset-0 z-40 cursor-default bg-black/40" onClick={() => state.setOpen(false)} />
    <aside ref={drawerRef} id={state.panelId} aria-label="Filtros" data-side={side} className="ds-filter-drawer">{content}</aside>
  </>
}

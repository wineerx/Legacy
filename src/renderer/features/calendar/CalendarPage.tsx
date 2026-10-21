import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgendaSheet } from './AgendaSheet'
import { ContainerDraftSheet } from '../library/ContainerDraftSheet'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { agendaRange, shiftAnchor, layoutDay, localDate, addDays, dayStart, type AgendaItem, type AgendaView } from '@shared/agenda'
import type { PublicationContainerState } from '@shared/publication-containers'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Spinner, EmptyState, cx, FilterBar, FacetFilter, ActiveFilters, Segmented, type Tone } from '../../components/ui'
import { Progress } from '../../components/ui/Progress'
import { FieldError } from '../../components/ui/Field'
import type { PageProps } from '../../routes'

const STATE: Record<PublicationContainerState, string> = { draft: 'Rascunho', scheduled: 'Agendado', in_progress: 'Em andamento', paused: 'Pausado', completed: 'Concluído', completed_with_failures: 'Concluído com falhas', cancelled: 'Cancelado' }
const STATE_TONES: Record<PublicationContainerState, Tone> = { draft: 'neutral', scheduled: 'blue', in_progress: 'orange', paused: 'yellow', completed: 'green', completed_with_failures: 'red', cancelled: 'neutral' }
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOUR_PX = 48
const startOf = (i: AgendaItem) => Date.parse(i.plannedStartAt!)
const endOf = (i: AgendaItem) => Date.parse(i.plannedEndAt ?? i.plannedStartAt!)

/** One Container as the Agenda shows it: destination, size, planned window and progress. Never one entry per job. */
function ContainerBlock({ item, timeZone, compact = false, onOpen }: { item: AgendaItem; timeZone: string; compact?: boolean; onOpen(item: AgendaItem): void }) {
  const time = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' })
  const done = item.counts.confirmed, total = item.counts.total
  return <button type="button" onClick={() => onOpen(item)} aria-label={`Abrir ${item.name}`} className="block h-full w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"><article aria-label={item.name} data-state={item.state} className={cx('agenda-block grid h-full min-w-0 content-start gap-0.5 overflow-hidden rounded-ctl border bg-panel px-2 py-1 text-[11px]', item.state === 'draft' ? 'border-dashed border-line text-dim' : 'border-line', item.delayMin ? 'border-l-2 border-l-danger-fg' : '')}>
    <p className="truncate text-dim">{item.provider ? `Instagram${item.username ? ` · @${item.username}` : ''}` : 'Sem destino'}</p>
    <p className="truncate font-semibold text-fg">{item.name}</p>
    {!compact && <p>{total} publicações</p>}
    <p>{time(startOf(item))} → {time(endOf(item))}</p>
    {!compact && item.state !== 'draft' && <><Progress value={done / Math.max(1, total) * 100} label={`Progresso de ${item.name}`} /><p>{done}/{total}{item.delayMin ? ` · +${item.delayMin} min` : ''} · {STATE[item.state]}</p></>}
    {!compact && item.state === 'draft' && <p>Rascunho</p>}
  </article></button>
}

function TimeGrid({ days, items, timeZone, today, onOpen }: { days: string[]; items: AgendaItem[]; timeZone: string; today: string; onOpen(item: AgendaItem): void }) {
  const blocks = items.map(i => ({ id: i.id, start: startOf(i), end: endOf(i) }))
  // Open at the first Container of the period (one hour earlier), not at midnight.
  const scroller = useRef<HTMLDivElement>(null)
  const first = Math.min(...days.flatMap(d => layoutDay(blocks, d, timeZone).map(b => b.top)), 1)
  useEffect(() => { if (scroller.current && first < 1) scroller.current.scrollTop = Math.max(0, first * 24 * HOUR_PX - HOUR_PX) }, [first])
  return <div ref={scroller} className="max-h-[70vh] overflow-auto rounded-card border border-line" data-testid="agenda-time-grid">
    <div className="sticky top-0 z-10 grid border-b border-line bg-app" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(140px, 1fr))` }}>
      <span />{days.map(d => <span key={d} className={cx('px-2 py-2 text-xs', d === today ? 'font-semibold text-fg' : 'text-dim')}>{WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} {d.slice(8)}/{d.slice(5, 7)}</span>)}
    </div>
    <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(140px, 1fr))`, height: 24 * HOUR_PX }}>
      <div className="relative">{Array.from({ length: 24 }, (_, h) => <span key={h} className="absolute right-2 text-[10px] text-dim" style={{ top: h * HOUR_PX }}>{String(h).padStart(2, '0')}:00</span>)}</div>
      {days.map(d => <div key={d} className="relative border-l border-line" aria-label={`Dia ${d}`} style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px ${HOUR_PX}px)` }}>
        {layoutDay(blocks, d, timeZone).map(b => { const item = items.find(i => i.id === b.id)!
          return <div key={b.id} className="absolute p-0.5" style={{ top: `${b.top * 100}%`, height: `${b.height * 100}%`, left: `${b.lane / b.lanes * 100}%`, width: `${100 / b.lanes}%` }}>
            <ContainerBlock item={item} timeZone={timeZone} compact={b.height < 0.08} onOpen={onOpen} />
          </div> })}
      </div>)}
    </div>
  </div>
}

function MonthGrid({ days, items, timeZone, month, today, onOpen }: { days: string[]; items: AgendaItem[]; timeZone: string; month: string; today: string; onOpen(item: AgendaItem): void }) {
  const byDay = new Map<string, AgendaItem[]>()
  for (const i of items) for (let d = localDate(startOf(i), timeZone); d <= localDate(endOf(i), timeZone); d = addDays(d, 1)) byDay.set(d, [...(byDay.get(d) ?? []), i])
  return <div className="grid grid-cols-7 overflow-hidden rounded-card border border-line" data-testid="agenda-month">
    {WEEKDAYS.map(w => <span key={w} className="border-b border-line bg-app px-2 py-1 text-[11px] text-dim">{w}</span>)}
    {days.map(d => { const list = byDay.get(d) ?? []
      return <div key={d} aria-label={`Dia ${d}`} className={cx('grid min-h-28 content-start gap-1 border-b border-l border-line p-1', d.slice(0, 7) !== month && 'opacity-50')}>
        <span className={cx('text-[11px]', d === today ? 'font-semibold text-fg' : 'text-dim')}>{Number(d.slice(8))}</span>
        {list.slice(0, 3).map(i => <ContainerBlock key={i.id} item={i} timeZone={timeZone} compact onOpen={onOpen} />)}
        {list.length > 3 && <span className="text-[11px] text-dim">+{list.length - 3} Container(s)</span>}
      </div> })}
  </div>
}

function Timeline({ days, items, timeZone, onOpen }: { days: string[]; items: AgendaItem[]; timeZone: string; onOpen(item: AgendaItem): void }) {
  const from = dayStart(days[0], timeZone), to = dayStart(addDays(days[days.length - 1], 1), timeZone), span = to - from
  return <div className="grid gap-1 rounded-card border border-line p-3" data-testid="agenda-timeline">
    <div className="ml-[30%] grid grid-cols-7 text-[11px] text-dim">{days.map(d => <span key={d}>{WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} {d.slice(8)}</span>)}</div>
    {items.map(i => { const left = Math.max(0, (startOf(i) - from) / span), right = Math.min(1, (endOf(i) - from) / span)
      return <div key={i.id} className="grid grid-cols-[30%_70%] items-center gap-2 text-xs">
        <button type="button" onClick={() => onOpen(i)} className="truncate text-left hover:underline">{i.name} <span className="text-dim">· @{i.username ?? '—'}</span></button>
        <div className="relative h-6 rounded-ctl bg-raised" role="img" aria-label={`${i.name}: ${new Date(startOf(i)).toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })} → ${new Date(endOf(i)).toLocaleString('pt-BR', { timeZone, timeStyle: 'short' })}`}>
          <span className={cx('absolute inset-y-0 rounded-ctl', i.state === 'draft' ? 'border border-dashed border-fg/50' : i.delayMin ? 'bg-danger-fg/70' : 'bg-fg/70')} style={{ left: `${left * 100}%`, width: `${Math.max(0.6, (right - left) * 100)}%` }} />
        </div>
      </div> })}
  </div>
}

export function CalendarPage(_: PageProps) {
  const { workspace } = useWorkspace(), timeZone = workspace.timeZone
  const today = localDate(Date.now(), timeZone)
  const [view, setView] = useState<AgendaView>('week'), [anchor, setAnchor] = useState(today), [accountId, setAccountId] = useState(''), [states, setStates] = useState<string[]>([])
  const [open, setOpen] = useState<AgendaItem | null>(null), [editing, setEditing] = useState<string | null>(null)
  const qc = useQueryClient()
  const range = useMemo(() => agendaRange(view, anchor, timeZone), [view, anchor, timeZone])
  const accounts = useQuery({ queryKey: ['agenda-accounts', workspace.id], queryFn: () => call('accounts.instagramList', { workspaceId: workspace.id }) })
  const agenda = useQuery({ queryKey: ['agenda', workspace.id, range.from, range.to, accountId], refetchInterval: 60_000,
    queryFn: () => call('agenda.range', { workspaceId: workspace.id, from: range.from, to: range.to, ...(accountId ? { accountId } : {}) }) })
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const label = view === 'month' ? new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : view === 'day' ? new Date(`${anchor}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' })
      : `${range.days[0].slice(8)}/${range.days[0].slice(5, 7)} – ${range.days[6].slice(8)}/${range.days[6].slice(5, 7)}/${range.days[6].slice(0, 4)}`
  const allItems = agenda.data?.items ?? []
  const items = states.length ? allItems.filter(i => states.includes(i.state)) : allItems
  return <section className="flex flex-col gap-4 p-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Calendário</h1><p className="text-xs text-dim">Containers por janela planejada, no fuso {timeZone}. Cada bloco reúne todas as publicações do Container.</p></div>
    </header>
    <section aria-label="Filtros do calendário" className="ds-filter-card">
      <FilterBar label="Navegar e filtrar calendário" actions={<Segmented<AgendaView> label="Visualização" value={view} onChange={setView} options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }, { value: 'timeline', label: 'Timeline' }]} />}>
        <Button size="sm" onClick={() => setAnchor(today)}>Hoje</Button>
        <Button size="sm" variant="ghost" aria-label="Período anterior" onClick={() => setAnchor(a => shiftAnchor(view, a, -1))}><ChevronLeft size={14} aria-hidden /></Button>
        <h2 className="min-w-40 text-sm font-semibold" aria-live="polite">{sentence(label)}</h2>
        <Button size="sm" variant="ghost" aria-label="Próximo período" onClick={() => setAnchor(a => shiftAnchor(view, a, 1))}><ChevronRight size={14} aria-hidden /></Button>
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <FacetFilter label="Conta" icon={<Users size={13} aria-hidden />} value={accountId ? [accountId] : []} onChange={v => setAccountId(v[0] ?? '')} options={(accounts.data ?? []).map(a => ({ value: a.id, label: `@${a.username}` }))} />
        <FacetFilter multiple label="Estado" value={states} onChange={setStates} options={Object.entries(STATE).map(([key, value]) => ({ value: key, label: value, tone: STATE_TONES[key as PublicationContainerState], count: allItems.filter(i => i.state === key).length }))} />
      </FilterBar>
      <ActiveFilters noun="Container(s)" total={agenda.data ? items.length : undefined} onClear={() => { setAccountId(''); setStates([]) }} filters={[
        ...(accountId ? [{ key: 'account', label: `Conta: @${accounts.data?.find(a => a.id === accountId)?.username ?? '—'}`, clear: () => setAccountId('') }] : []),
        ...states.map(st => ({ key: st, label: STATE[st as PublicationContainerState], clear: () => setStates(states.filter(x => x !== st)) }))
      ]} />
    </section>
    {agenda.isLoading && <Spinner label="Carregando agenda" />}
    {agenda.isError && <FieldError>Não foi possível carregar a agenda. <Button size="sm" onClick={() => void agenda.refetch()}>Tentar novamente</Button></FieldError>}
    {agenda.data?.truncated && <p role="status" className="text-xs text-warn">Muitos Containers neste período; exibindo os primeiros. Use o filtro por conta ou uma visualização menor.</p>}
    {agenda.data && !items.length && <EmptyState icon={null} title={allItems.length ? 'Nenhum Container com estes filtros' : 'Nenhum Container neste período'} body="Agende ou distribua Containers pela Biblioteca para vê-los aqui." />}
    {agenda.data && items.length > 0 && (view === 'month' ? <MonthGrid days={range.days} items={items} timeZone={timeZone} month={anchor.slice(0, 7)} today={today} onOpen={setOpen} />
      : view === 'timeline' ? <Timeline days={range.days} items={items} timeZone={timeZone} onOpen={setOpen} />
        : <TimeGrid days={range.days} items={items} timeZone={timeZone} today={today} onOpen={setOpen} />)}
    {open && <AgendaSheet workspaceId={workspace.id} containerId={open.id} username={open.username} onClose={() => setOpen(null)} onEdit={id => { setOpen(null); setEditing(id) }} />}
    {editing && <ContainerDraftSheet workspaceId={workspace.id} timeZone={timeZone} request={{ mode: 'manage', videos: [], containerId: editing }} onClose={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['agenda', workspace.id] }) }} />}
  </section>
}

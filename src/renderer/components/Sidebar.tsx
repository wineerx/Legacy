import * as Popover from '@radix-ui/react-popover'
import { Progress } from './ui/Progress'
import { FirstSteps } from '../features/onboarding/FirstSteps'
import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { NAV, type PageKey } from '../routes'
import { cx, Tooltip } from './ui'
import { SidebarUser } from './SidebarUser'
import { LegacyLogo } from './brand/LegacyMascot'
import { useMascot } from './brand/MascotProvider'

type Props = { current: PageKey; onNavigate(p: PageKey): void; unread: number; collapsed: boolean; onToggle(): void }

export function Sidebar({ current, onNavigate, unread, collapsed, onToggle }: Props) {
  const [q, setQ] = useState('')
  const mascot = useMascot()
  const [showStatus, setShowStatus] = useState(false)
  const [reaction, setReaction] = useState(0)
  const items = collapsed ? NAV : NAV.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase()))
  const link = (n: (typeof NAV)[number]) => {
    const Icon = n.icon
    const badge = n.key === 'notifications' ? unread : null
    const anchor = (
      <a key={n.key} href={`#${n.key}`} aria-current={current === n.key ? 'page' : undefined} aria-label={collapsed ? (badge !== null ? `${n.label}, ${badge} não lidas` : n.label) : n.label}
        onClick={(e) => { e.preventDefault(); onNavigate(n.key) }}
        className={cx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-ctl px-2.5 text-sm', current === n.key ? 'bg-raised text-fg' : 'text-dim hover:bg-raised/60 hover:text-fg')}>
        <Icon size={16} className="shrink-0" aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {badge !== null && <span className={cx('rounded-full bg-fg px-1 text-[10px] font-semibold leading-4 text-app', collapsed && 'absolute -top-1 right-0')}>{badge! > 99 ? '99+' : badge}</span>}
      </a>
    )
    return collapsed ? <Tooltip key={n.key} content={n.label}>{anchor}</Tooltip> : anchor
  }
  return (
    <nav aria-label="Principal" className={cx('flex h-full min-h-0 shrink-0 flex-col overflow-y-auto border-r border-line bg-side p-2 transition-[width]', collapsed ? 'w-14' : 'w-66')}>
      <div className="mascot-sidebar-brand"><Popover.Root open={showStatus} onOpenChange={setShowStatus}><Popover.Trigger asChild>
        <button type="button" aria-label="Interagir com o mascote Legacy" aria-expanded={showStatus} onMouseEnter={mascot.react} onClick={() => { mascot.react(); setReaction(value => value + 1) }} onKeyDown={event => { if (event.key === 'Escape') setShowStatus(false) }} className={cx('mb-4 mt-1 flex rounded-ctl', collapsed ? 'justify-center' : 'px-1')}><span key={reaction} className={reaction ? 'mascot-react' : undefined}><LegacyLogo compact={collapsed} state={mascot.state} interactive /></span></button></Popover.Trigger>
        <Popover.Portal><Popover.Content side="right" align="start" sideOffset={8} className="ds-dropdown w-60" aria-label="Status da fila"><div role="status"><span aria-hidden className="mb-2 flex gap-1">{[0,1,2].map(n=><i key={n} className="size-1 rounded-full bg-dim"/>)}</span><p>{mascot.message}</p><div className="my-2"><Progress value={mascot.progress} label="Tarefas concluídas"/></div><p className="mt-1 text-dim">{mascot.running} em execução · {mascot.queued} na fila</p></div><Popover.Arrow className="fill-panel"/></Popover.Content></Popover.Portal></Popover.Root>
      </div>
      <div className="mb-2 flex items-center gap-1">
        {!collapsed && (
          <label className="flex h-8 flex-1 items-center gap-2 rounded-ctl bg-raised px-2.5 text-dim">
            <Search size={14} aria-hidden />
            <input type="search" aria-label="Buscar no menu" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-dim" />
          </label>
        )}
        <Tooltip content={collapsed ? 'Expandir menu' : 'Recolher menu'}><button type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed} className="flex size-8 shrink-0 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button></Tooltip>
      </div>
      <div className="flex flex-1 flex-col gap-0.5">{items.map(link)}</div>
      {!collapsed && <FirstSteps navigate={onNavigate} />}
      <div className="border-t border-line pt-2"><SidebarUser collapsed={collapsed} current={current} navigate={onNavigate}/></div>
    </nav>
  )
}

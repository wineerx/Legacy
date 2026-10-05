import { useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { NAV, SETTINGS_NAV, type PageKey } from '../routes'
import { cx } from './ui'

type Props = { current: PageKey; onNavigate(p: PageKey): void; unread: number; collapsed: boolean; onToggle(): void }

export function Sidebar({ current, onNavigate, unread, collapsed, onToggle }: Props) {
  const [q, setQ] = useState('')
  const items = collapsed ? NAV : NAV.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase()))
  const link = (n: { key: PageKey; label: string; icon: typeof SETTINGS_NAV.icon }) => {
    const Icon = n.icon
    const badge = n.key === 'notifications' && unread > 0 ? unread : null
    return (
      <a key={n.key} href={`#${n.key}`} aria-current={current === n.key ? 'page' : undefined} aria-label={collapsed ? (badge !== null ? `${n.label}, ${badge} não lidas` : n.label) : undefined}
        onClick={(e) => { e.preventDefault(); onNavigate(n.key) }}
        className={cx('flex h-8 items-center gap-2.5 rounded-ctl px-2.5 text-sm', current === n.key ? 'bg-raised text-fg' : 'text-dim hover:bg-raised/60 hover:text-fg')}>
        <Icon size={16} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {badge !== null && <span className="rounded-full bg-fg px-1.5 text-[11px] font-semibold text-app">{badge}</span>}
      </a>
    )
  }
  return (
    <nav aria-label="Principal" className={cx('flex h-full flex-col border-r border-line bg-side p-2 transition-[width]', collapsed ? 'w-14' : 'w-66')}>
      <div className="mb-2 flex items-center gap-1">
        {!collapsed && (
          <label className="flex h-8 flex-1 items-center gap-2 rounded-ctl bg-raised px-2.5 text-dim">
            <Search size={14} aria-hidden />
            <input type="search" aria-label="Buscar no menu" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-dim" />
          </label>
        )}
        <button type="button" onClick={onToggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!collapsed} className="rounded-ctl p-1.5 text-dim hover:bg-raised hover:text-fg">
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-0.5">{items.map(link)}</div>
      <div className="border-t border-line pt-2">{link(SETTINGS_NAV)}</div>
    </nav>
  )
}

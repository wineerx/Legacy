import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { call } from '../lib/api'
import { useWorkspace } from '../lib/workspace'
import { cx, Tooltip } from './ui'
import type { PageKey } from '../routes'

/** First letter of the handle (digits and symbols skipped), so @365spiders reads as S, not 36. */
const initials = (u: string) => (u.match(/[a-z]/i)?.[0] ?? u.charAt(0) ?? '@').toUpperCase()
function Avatar({ username, size = 28 }: { username: string; size?: number }) {
  return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-fg ring-1 ring-line" style={{ width: size, height: size }}>{initials(username)}</span>
}

/**
 * Active Instagram account, above the menu search: the default destination of new publications.
 * Selecting another account never moves jobs already scheduled (each Container keeps its destination).
 */
export function AccountSwitcher({ collapsed, onNavigate }: { collapsed: boolean; onNavigate(p: PageKey): void }) {
  const { workspace } = useWorkspace(), qc = useQueryClient(), [open, setOpen] = useState(false)
  const list = useQuery({ queryKey: ['switcher-accounts', workspace.id], queryFn: () => call('accounts.instagramList', { workspaceId: workspace.id }) })
  const active = useQuery({ queryKey: ['switcher-active', workspace.id], queryFn: () => call('accounts.instagram', { workspaceId: workspace.id }) })
  const select = useMutation({ mutationFn: (accountId: string) => call('accounts.setDefault', { workspaceId: workspace.id, accountId }),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries() } })
  const accounts = list.data ?? [], current = active.data
  const trigger = <Popover.Trigger aria-label={current ? `Conta ativa: @${current.username}. Trocar conta` : 'Selecionar conta'}
    className={cx('flex w-full min-w-0 items-center gap-2 rounded-ctl py-1.5 text-left hover:bg-raised data-[state=open]:bg-raised', collapsed ? 'justify-center px-0' : 'px-2')}>
    {current ? <Avatar username={current.username} /> : <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-dim"><Plus size={14} /></span>}
    {!collapsed && <><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{current ? `@${current.username}` : 'Nenhuma conta'}</strong><span className="block truncate text-[11px] text-dim">{current ? 'Instagram' : 'Conecte uma conta'}</span></span><ChevronsUpDown size={14} className="shrink-0 text-dim" aria-hidden /></>}
  </Popover.Trigger>
  return <div className="mb-2">
    <Popover.Root open={open} onOpenChange={setOpen}>
      {collapsed ? <Tooltip content={current ? `@${current.username}` : 'Selecionar conta'}>{trigger}</Tooltip> : trigger}
      <Popover.Portal><Popover.Content side={collapsed ? 'right' : 'bottom'} align="start" sideOffset={6} collisionPadding={12} aria-label="Contas" className="ds-dropdown z-50 w-64 p-1">
        <p className="px-2 pb-1 pt-1.5 text-[11px] text-dim">Contas</p>
        {list.isLoading && <p className="px-2 py-2 text-xs text-dim">Carregando contas…</p>}
        {list.isError && <p role="alert" className="px-2 py-2 text-xs text-danger-fg">Não foi possível carregar as contas.</p>}
        {!list.isLoading && !accounts.length && <p className="px-2 py-2 text-xs text-dim">Nenhuma conta conectada.</p>}
        <ul aria-label="Contas conectadas">{accounts.map(a => { const selected = a.id === current?.id
          return <li key={a.id}><button type="button" aria-current={selected ? 'true' : undefined} aria-label={`@${a.username}${selected ? ', conta ativa' : ''}`} disabled={select.isPending} onClick={() => selected ? setOpen(false) : select.mutate(a.id)}
            className="flex w-full items-center gap-2.5 rounded-ctl px-2 py-1.5 text-left hover:bg-raised disabled:opacity-60">
            <Avatar username={a.username} size={30} />
            <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{a.username}</strong><span className="block truncate text-[11px] text-dim">@{a.username} · Instagram</span></span>
            <span aria-hidden className={cx('flex size-4 shrink-0 items-center justify-center rounded-full', selected ? 'bg-fg text-app' : 'border border-line')}>{selected && <Check size={11} strokeWidth={3} />}</span>
          </button></li> })}</ul>
        {select.isError && <p role="alert" className="px-2 py-1 text-xs text-danger-fg">{select.error instanceof Error ? select.error.message : 'Não foi possível trocar a conta.'}</p>}
        <div className="my-1 border-t border-line" />
        <button type="button" onClick={() => { setOpen(false); onNavigate('accounts') }} className="flex w-full items-center gap-2.5 rounded-ctl px-2 py-1.5 text-xs hover:bg-raised"><Plus size={14} aria-hidden />Adicionar conta</button>
        <p className="px-2 pb-1.5 pt-1 text-[11px] text-dim">A conta ativa é o destino padrão de novas publicações. Agendamentos existentes mantêm o destino.</p>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </div>
}

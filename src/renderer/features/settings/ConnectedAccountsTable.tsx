import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Badge, Button, Dropdown, DropdownClose, Modal, Spinner } from '../../components/ui'

type Account = { id: string; username: string; revision: string; validatedAt: string }

function QuotaCell({ accountId }: { accountId: string }) {
  const { workspace } = useWorkspace()
  const q = useQuery({ queryKey: ['quota', workspace.id, accountId, ''], queryFn: () => call('quota.get', { workspaceId: workspace.id, accountId, slots: [] }) })
  const s = q.data?.snapshot
  if (q.isLoading) return <span className="text-dim">…</span>
  if (!s || s.usage === null || s.total === null) return <span className="text-dim" title="Indisponível">—</span>
  return <span className="tabular-nums">{s.usage} / {s.total}{s.freshness !== 'fresh' && <span className="ml-1 text-[11px] text-dim">(desatualizada)</span>}</span>
}

/**
 * Every connected Instagram account in one table: which one is active (default destination), when it was
 * verified, its last quota reading and its actions. Disconnecting always asks for confirmation.
 */
export function ConnectedAccountsTable({ accounts, activeId, onManage, onError, onChanged }: { accounts: Account[]; activeId: string | null; onManage(): void; onError(e: unknown): void; onChanged(): void }) {
  const { workspace } = useWorkspace(), qc = useQueryClient()
  const [removing, setRemoving] = useState<Account | null>(null)
  const act = useMutation({
    mutationFn: ({ action, id }: { action: 'activate' | 'verify' | 'disconnect'; id: string }) => action === 'activate' ? call('accounts.setDefault', { workspaceId: workspace.id, accountId: id })
      : action === 'verify' ? call('accounts.verifyInstagram', { workspaceId: workspace.id, accountId: id }) : call('accounts.disconnectInstagram', { workspaceId: workspace.id, accountId: id }),
    onSuccess: () => { setRemoving(null); void qc.invalidateQueries(); onChanged() }, onError
  })
  const date = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: workspace.timeZone, dateStyle: 'short', timeStyle: 'short' })
  return <div className="overflow-x-auto rounded-card border border-line bg-panel">
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="border-b border-line text-xs text-dim"><tr>
        <th scope="col" className="px-4 py-3 font-medium">Conta</th><th scope="col" className="px-4 py-3 font-medium">Plataforma</th>
        <th scope="col" className="px-4 py-3 font-medium">Verificada em</th><th scope="col" className="px-4 py-3 font-medium">Quota</th>
        <th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody className="divide-y divide-line">{accounts.map(a => { const active = a.id === activeId
        return <tr key={a.id}>
          <td className="px-4 py-3"><span className="font-medium">@{a.username}</span>{active && <span className="ml-2 text-[11px] text-dim">Conta ativa</span>}</td>
          <td className="px-4 py-3 text-dim">Instagram</td>
          <td className="px-4 py-3 tabular-nums text-dim">{date(a.validatedAt)}</td>
          <td className="px-4 py-3"><QuotaCell accountId={a.id} /></td>
          <td className="px-4 py-3"><Badge tone="success">Conectada</Badge></td>
          <td className="px-4 py-3 text-right">
            {act.isPending && act.variables?.id === a.id ? <Spinner label="Atualizando conta" /> :
              <Dropdown trigger={<button type="button" aria-label={`Ações de @${a.username}`} className="inline-flex size-8 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"><MoreHorizontal size={18} /></button>}>
                {!active && <DropdownClose asChild><button type="button" onClick={() => act.mutate({ action: 'activate', id: a.id })}>Tornar conta ativa</button></DropdownClose>}
                <DropdownClose asChild><button type="button" onClick={() => act.mutate({ action: 'verify', id: a.id })}>Verificar conexão</button></DropdownClose>
                <DropdownClose asChild><button type="button" onClick={onManage}>Gerenciar conexão</button></DropdownClose>
                <DropdownClose asChild><button type="button" className="text-danger-fg" onClick={() => setRemoving(a)}>Desconectar conta</button></DropdownClose>
              </Dropdown>}
          </td>
        </tr> })}</tbody>
    </table>
    <Modal open={!!removing} onOpenChange={o => !o && setRemoving(null)} title={removing ? `Desconectar @${removing.username}?` : ''}
      description="O token será removido deste workspace. Agendamentos dessa conta deixarão de ter autorização; o histórico permanece."
      footer={<><Button onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" loading={act.isPending} onClick={() => removing && act.mutate({ action: 'disconnect', id: removing.id })}>Desconectar</Button></>} />
  </div>
}

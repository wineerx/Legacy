import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Download, Send, CheckCheck, Check, FolderOpen, ListOrdered, CircleAlert, Trash2 } from 'lucide-react'
import type { NotificationDto } from '@shared/ipc-contract'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, CollapsibleCard, EmptyState, Pills, useToast, cx, Modal, Checkbox } from '../../components/ui'
import { ActionIcon } from '../../components/ActionIcon'
import type { PageProps } from '../../routes'
import { groupNotifications } from './groups'

function parseAction(json: string | null): { type: string; path?: string; jobId?: string } | null {
  try { const a = JSON.parse(json ?? '{}'); return a.type === 'open_folder' || a.type === 'open_queue' ? a : null } catch { return null }
}
export function NotificationsPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace(); const qc = useQueryClient(); const toast = useToast()
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const list = useQuery({ queryKey: ['notifications', workspace.id], queryFn: () => call('notifications.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const fail = () => toast.show({ title: 'Não foi possível atualizar as notificações.', tone: 'error' })
  const readAll = useMutation({ mutationFn: () => call('notifications.markAllRead', { workspaceId: workspace.id }), onSuccess: () => qc.invalidateQueries(), onError: fail })
  const read = useMutation({ mutationFn: async (ids: string[]) => { for (const id of ids) await call('notifications.markRead', { workspaceId: workspace.id, id }) }, onSuccess: () => qc.invalidateQueries(), onError: fail })
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: workspace.timeZone, dateStyle: 'short', timeStyle: 'short' })
  const act = async (n: NotificationDto) => {
    const a = parseAction(n.actionJson)
    if (a?.type === 'open_queue') navigate('queue')
    if (a?.type === 'open_folder' && a.path) {
      try { await call('export.openFolder', { workspaceId: workspace.id, path: a.path }) }
      catch (e) { toast.show({ title: 'Não foi possível abrir a pasta', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }); return }
    }
    read.mutate([n.id])
  }
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<{ ids?: string[]; all?: boolean } | null>(null)
  const remove = useMutation({ mutationFn: (input: { ids?: string[]; all?: boolean }) => call('notifications.delete', { workspaceId: workspace.id, ...input }), onSuccess: () => { setSelected(new Set()); setDeleting(null); void qc.invalidateQueries() }, onError: fail })
  const groups = groupNotifications(list.data ?? [], filter)
  return <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-4 p-6">
    <header data-tour="notifications" className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-lg font-semibold">Notificações</h1><ActionIcon label="Marcar todas como lidas" disabled={readAll.isPending || !list.data?.some(n => !n.readAt)} onClick={() => readAll.mutate()}><CheckCheck size={18} /></ActionIcon></header>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => {setSelecting(!selecting);setSelected(new Set())}}>{selecting ? 'Cancelar seleção' : 'Selecionar notificações'}</Button><Button size="sm" disabled={!list.data?.length || remove.isPending} onClick={() => setDeleting({ all: true })}>Excluir todas</Button>{selecting && <><Checkbox label="Selecionar todas" checked={groups.flatMap(g => g.items).length > 0 && groups.flatMap(g => g.items).every(n => selected.has(n.id))} onChange={e => setSelected(new Set(e.target.checked ? groups.flatMap(g => g.items.map(n => n.id)) : []))}/><Button size="sm" disabled={!selected.size || remove.isPending} onClick={() => selected.size > 1 ? setDeleting({ ids: [...selected] }) : remove.mutate({ ids: [...selected] })}>Excluir selecionadas ({selected.size})</Button></>}</div>
    <Modal open={!!deleting} onOpenChange={open => !open && setDeleting(null)} title="Excluir notificações?" description={deleting?.all ? 'Todas as notificações deste workspace serão excluídas. As tarefas e o histórico de publicação permanecem.' : `${deleting?.ids?.length ?? 0} notificações serão excluídas.`} footer={<><Button onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="primary" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>Confirmar exclusão</Button></>}/>
    <Pills label="Filtrar notificações" value={filter} onChange={setFilter} options={[{value:'all',label:'Todas'},{value:'unread',label:'Não lidas'},{value:'download',label:'Downloads'},{value:'publication',label:'Publicações'},{value:'error',label:'Falhas'},{value:'system',label:'Sistema'}]} />
    {list.isError && <p role="alert" className="text-sm text-danger-fg">Não foi possível carregar as notificações.</p>}
    {list.isLoading && <p role="status">Carregando…</p>}
    {!groups.length && !list.isLoading && !list.isError && <EmptyState icon={<Bell size={28} />} title="Tudo em dia" body="Nenhuma notificação neste filtro." />}
    {groups.map(g => {
      const Icon = g.category === 'download' ? Download : g.category === 'publication' ? Send : Bell
      const unread = g.items.filter(n => !n.readAt).length
      const rows = <ul className="divide-y divide-line">{g.items.map(n => { const a = parseAction(n.actionJson); return <li key={n.id} className={cx('flex min-w-0 items-start gap-3 p-4', !n.readAt && 'bg-raised/40')}>
        {selecting && <input type="checkbox" aria-label={`Selecionar ${n.title}`} checked={selected.has(n.id)} onChange={e => setSelected(old => {const next = new Set(old);if(e.target.checked)next.add(n.id);else next.delete(n.id);return next})} className="mt-1 shrink-0 accent-fg"/>}
        {n.kind === 'error' ? <CircleAlert aria-label="Falha" size={16} className="mt-1 shrink-0 text-danger-fg" /> : <Icon aria-hidden size={16} className="mt-1 shrink-0 text-dim" />}
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{n.title}{!n.readAt && <span className="sr-only"> (não lida)</span>}</p><p className="mt-1 break-words text-xs text-dim">{n.body}</p><time className="mt-2 block text-[11px] text-mute">{fmt.format(new Date(n.dueAt ?? n.createdAt))}</time></div>
        {a ? <ActionIcon label={a.type === 'open_folder' ? 'Abrir pasta' : 'Ver na fila'} size="sm" onClick={() => void act(n)}>{a.type === 'open_folder' ? <FolderOpen size={16} /> : <ListOrdered size={16} />}</ActionIcon> : !n.readAt && <ActionIcon label="Marcar como lida" size="sm" variant="ghost" onClick={() => read.mutate([n.id])}><Check size={16} /></ActionIcon>}
        <ActionIcon label={`Excluir ${n.title}`} size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate({ ids: [n.id] })}><Trash2 size={16}/></ActionIcon>
      </li> })}</ul>
      return g.items.length > 1 ? <CollapsibleCard key={g.id} open={expanded.has(g.id)} onOpenChange={open => setExpanded(old => {
        const next = new Set(old)
        if (open) next.add(g.id); else next.delete(g.id)
        return next
      })} title={<>{g.category === 'download' ? 'Downloads' : g.category === 'publication' ? 'Publicações' : 'Tarefa'} · {g.items.length} eventos · {unread} não lidas</>}>
        <div className="mb-2"><Button size="sm" disabled={!unread || read.isPending} onClick={() => read.mutate(g.items.filter(n => !n.readAt).map(n => n.id))}>Marcar grupo como lido</Button></div>{rows}
      </CollapsibleCard> : <section key={g.id} className="overflow-hidden rounded-card border border-line bg-panel">{rows}</section>
    })}
  </div>
}

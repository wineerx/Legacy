import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import type { NotificationDto } from '@shared/ipc-contract'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, useToast, cx } from '../../components/ui'
import type { PageProps } from '../../routes'

type Action = { type: 'open_folder'; path: string } | { type: 'open_queue'; jobId: string }

function parseAction(json: string | null): Action | null {
  if (!json) return null
  try { const a = JSON.parse(json) as Action | null; return a && (a.type === 'open_folder' || a.type === 'open_queue') ? a : null } catch { return null }
}

export function NotificationsPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['notifications', workspace.id], queryFn: () => call('notifications.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const readAll = useMutation({ mutationFn: () => call('notifications.markAllRead', { workspaceId: workspace.id }), onSuccess: () => qc.invalidateQueries(), onError: () => toast.show({ title: 'Não foi possível marcar as notificações.', tone: 'error' }) })
  const read = useMutation({ mutationFn: (id: string) => call('notifications.markRead', { workspaceId: workspace.id, id }), onSuccess: () => qc.invalidateQueries(), onError: () => toast.show({ title: 'Não foi possível marcar a notificação.', tone: 'error' }) })
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: workspace.timeZone, dateStyle: 'short', timeStyle: 'short' })

  const act = async (n: NotificationDto) => {
    const a = parseAction(n.actionJson)
    if (a?.type === 'open_queue') navigate('queue')
    if (a?.type === 'open_folder') {
      try { await call('export.openFolder', { workspaceId: workspace.id, path: a.path }) }
      catch (e) { toast.show({ title: 'Não foi possível abrir a pasta', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }); return }
    }
    read.mutate(n.id)
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header data-tour="notifications" className="flex items-center justify-between"><h1 className="text-lg font-semibold">Notificações</h1><Button disabled={readAll.isPending || !list.data?.some((n) => !n.readAt)} onClick={() => readAll.mutate()}>Marcar todas como lidas</Button></header>
      {list.isError && <p role="alert" className="text-sm text-danger-fg">Não foi possível carregar as notificações.</p>}
      {list.data && list.data.length === 0
        ? <EmptyState icon={<Bell size={28} />} title="Tudo em dia" body="Lembretes de postagem e falhas de processamento aparecem aqui." />
        : (
          <ul className="flex flex-col gap-2">
            {list.data?.map((n) => {
              const action = parseAction(n.actionJson)
              return (
              <li key={n.id} className={cx('flex items-start gap-3 rounded-card border p-3', n.readAt ? 'border-line bg-app' : 'border-line-strong bg-panel')}>
                <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : n.kind === 'error' ? 'bg-danger' : 'bg-fg')} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{n.title}{!n.readAt && <span className="sr-only"> (não lida)</span>}</p>
                  <p className="text-xs text-dim">{n.body}</p>
                  <p className="mt-1 text-[11px] text-mute">{fmt.format(new Date(n.dueAt ?? n.createdAt))}</p>
                </div>
                {action
                  ? <Button size="sm" onClick={() => void act(n)}>{action.type === 'open_folder' ? 'Abrir pasta' : 'Ver na fila'}</Button>
                  : !n.readAt && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>Marcar como lida</Button>}
              </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}

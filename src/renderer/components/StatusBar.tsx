import { useQuery } from '@tanstack/react-query'
import { call } from '../lib/api'
import { useWorkspace } from '../lib/workspace'
import { cx } from './ui'

export function StatusBar() {
  const { workspace, workerAlive } = useWorkspace()
  const jobs = useQuery({ queryKey: ['jobs', workspace.id], queryFn: () => call('jobs.list', { workspaceId: workspace.id }) })
  const running = jobs.data?.filter((j) => j.state === 'running').length ?? 0
  const queued = jobs.data?.filter((j) => j.state === 'queued').length ?? 0
  return (
    <footer className="flex h-7 items-center gap-4 border-t border-line bg-side px-3 text-xs text-dim">
      <span className="flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', workerAlive ? 'bg-ok' : 'bg-danger')} />{workerAlive ? 'Processador ativo' : 'Processador reiniciando'}</span>
      <span>{running} em execução · {queued} na fila</span>
      <span className="ml-auto">Tarefas rodam enquanto o PC estiver ligado e o Legacy aberto na bandeja.</span>
    </footer>
  )
}

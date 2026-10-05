import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListOrdered } from 'lucide-react'
import type { JobState } from '@shared/types'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, useToast, cx } from '../../components/ui'
import type { PageProps } from '../../routes'

const STATE: Record<JobState, { label: string; tone: string }> = {
  queued: { label: 'Na fila', tone: 'text-dim' }, running: { label: 'Em execução', tone: 'text-warn' },
  done: { label: 'Concluída', tone: 'text-ok' }, failed: { label: 'Falhou', tone: 'text-danger-fg' }, cancelled: { label: 'Cancelada', tone: 'text-mute' }
}

export function QueuePage(_: PageProps) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const fail = (title: string) => (e: unknown) => toast.show({ title, body: e instanceof ApiError ? e.message : undefined, tone: 'error' })
  const jobs = useQuery({ queryKey: ['jobs', workspace.id], queryFn: () => call('jobs.list', { workspaceId: workspace.id }), refetchInterval: 5000 })
  const cancel = useMutation({ mutationFn: (id: string) => call('jobs.cancel', { workspaceId: workspace.id, id }), onSuccess: () => qc.invalidateQueries(), onError: fail('Não foi possível cancelar') })
  const retry = useMutation({ mutationFn: (id: string) => call('jobs.retry', { workspaceId: workspace.id, id }), onSuccess: () => qc.invalidateQueries(), onError: fail('Não foi possível tentar de novo') })
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: workspace.timeZone, dateStyle: 'short', timeStyle: 'short' })
  return (
    <div className="flex flex-col gap-4 p-6">
      <header data-tour="queue"><h1 className="text-lg font-semibold">Fila</h1><p className="text-xs text-dim">Buscas, downloads, processamento, exportações e webhooks. Roda enquanto o PC estiver ligado e o Legacy aberto (inclusive na bandeja).</p></header>
      {jobs.data && jobs.data.length === 0 ? (
        <EmptyState icon={<ListOrdered size={28} />} title="Nada na fila" body="Miniaturas, banners e exportações aparecem aqui enquanto são processados." />
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs uppercase tracking-wide text-dim">
              <tr><th className="px-3 py-2">Tarefa</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Tentativas</th><th className="px-3 py-2">Atualizada</th><th className="px-3 py-2">Detalhe</th><th className="px-3 py-2"><span className="sr-only">Ações</span></th></tr>
            </thead>
            <tbody>
              {jobs.data?.map((j) => (
                <tr key={j.id} className="border-t border-line">
                  <td className="px-3 py-2">{j.label}</td>
                  <td className={cx('px-3 py-2', STATE[j.state].tone)}>{STATE[j.state].label}</td>
                  <td className="px-3 py-2 tabular-nums">{j.attempts}/{j.maxAttempts}</td>
                  <td className="px-3 py-2 text-dim">{fmt.format(new Date(j.updatedAt))}</td>
                  <td className="max-w-80 truncate px-3 py-2 text-xs text-dim" title={j.lastError ?? undefined}>{j.lastError ?? ''}</td>
                  <td className="px-3 py-2 text-right">
                    {j.state === 'queued' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>Cancelar</Button>}
                    {j.state === 'failed' && <Button size="sm" onClick={() => retry.mutate(j.id)}>Tentar de novo</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

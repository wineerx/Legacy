import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ListOrdered } from 'lucide-react'
import type { JobState } from '@shared/types'
import { call, ApiError, mediaUrl } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, Modal, useToast, cx } from '../../components/ui'
import type { PageProps } from '../../routes'

const STATE: Record<JobState, { label: string; tone: string }> = {
  queued: { label: 'Na fila', tone: 'text-dim' }, running: { label: 'Em execução', tone: 'text-warn' },
  done: { label: 'Concluída', tone: 'text-ok' }, failed: { label: 'Falhou', tone: 'text-danger-fg' }, cancelled: { label: 'Cancelada', tone: 'text-mute' }
}

export function QueuePage(_: PageProps) {
  const { workspace } = useWorkspace()
  const qc = useQueryClient()
  const toast = useToast()
  const [detailId, setDetailId] = useState<string | null>(null)
  const details = useQuery({ queryKey: ['job-details', workspace.id, detailId], queryFn: () => call('jobs.details', { workspaceId: workspace.id, id: detailId! }), enabled: Boolean(detailId), refetchInterval: 5000 })
  const open = useMutation({ mutationFn: (id: string) => call('library.openAsset', { workspaceId: workspace.id, id }), onError: (e) => toast.show({ title: 'Arquivo não abriu', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const folder = useMutation({ mutationFn: (path: string) => call('export.openFolder', { workspaceId: workspace.id, path }), onError: (e) => toast.show({ title: 'Pasta não abriu', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
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
        <div className="relative max-w-full overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[760px] text-sm">
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
                    <Button size="sm" variant="ghost" onClick={() => setDetailId(j.id)}>Ver tarefa</Button>
                    {j.state === 'queued' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>Cancelar</Button>}
                    {j.state === 'failed' && <Button size="sm" onClick={() => retry.mutate(j.id)}>Tentar de novo</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(detailId)} onOpenChange={(value) => { if (!value) setDetailId(null) }} title="Detalhes da tarefa" description={details.data?.label ?? 'Consultando arquivos e origem…'} footer={<Button onClick={() => setDetailId(null)}>Fechar</Button>}>
        <div className="flex min-w-0 flex-col gap-4">
          {details.isError && <p role="alert" className="text-danger-fg">Não foi possível consultar esta tarefa.</p>}
          {details.data && <><p className="text-xs text-dim">Execução prevista: {fmt.format(new Date(details.data.runAt))}</p>{details.data.error && <p className="break-words text-sm text-danger-fg">{details.data.error}</p>}{details.data.originUrl && <Button onClick={() => window.open(details.data!.originUrl!, '_blank')}>Abrir origem no Instagram</Button>}{details.data.files.map(f => <section key={f.id} className="min-w-0 rounded border border-line p-3"><p className="mb-2 break-words text-sm">{f.name}</p><video controls preload="metadata" src={mediaUrl(f.filePath)} poster={f.thumbnailPath ? mediaUrl(f.thumbnailPath) : undefined} className="mx-auto max-h-72 w-full object-contain" /><Button size="sm" className="mt-2" onClick={() => open.mutate(f.id)}>Abrir arquivo</Button></section>)}{details.data.folders.map(path => <Button key={path} onClick={() => folder.mutate(path)}>Abrir pasta exportada</Button>)}{!details.data.files.length && <p className="text-sm text-dim">O arquivo ainda não está na Biblioteca. Use o link de origem ou acompanhe o processamento.</p>}</>}
        </div>
      </Modal>
    </div>
  )
}

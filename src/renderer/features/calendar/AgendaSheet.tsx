import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicationContainerState } from '@shared/publication-containers'
import type { JobState } from '@shared/types'
import { call } from '../../lib/api'
import { Sheet } from '../../components/ui/Sheet'
import { Button, Spinner, Badge } from '../../components/ui'
import { Progress } from '../../components/ui/Progress'
import { FieldError } from '../../components/ui/Field'
import { ContainerWindowPanel } from '../library/ContainerWindowPanel'

const STATE: Record<PublicationContainerState, string> = { draft: 'Rascunho', scheduled: 'Agendado', in_progress: 'Em andamento', paused: 'Pausado', completed: 'Concluído', completed_with_failures: 'Concluído com falhas', cancelled: 'Cancelado' }
const JOB: Record<JobState, string> = { queued: 'Na fila', running: 'Enviando', done: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' }
const PAGE = 20

/**
 * Container details from the Calendar (PR 09): account, totals for the whole Container (not the page),
 * planned window and actions. Edit opens the draft editor; pause/resume use the PR 01 controls;
 * rescheduling is the PR 07 window adjustment, always confirmed.
 */
export function AgendaSheet({ workspaceId, containerId, username, onClose, onEdit }: { workspaceId: string; containerId: string; username: string | null; onClose(): void; onEdit(id: string): void }) {
  const qc = useQueryClient(), [page, setPage] = useState(1), [rescheduling, setRescheduling] = useState(false)
  const detail = useQuery({ queryKey: ['agenda-container', workspaceId, containerId, page], queryFn: () => call('containers.get', { workspaceId, containerId, page, pageSize: PAGE }) })
  const control = useMutation({
    mutationFn: (action: 'pause' | 'resume') => call(action === 'pause' ? 'containers.pause' : 'containers.resume', { workspaceId, containerId, expectedRevision: detail.data!.container.revision }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['agenda-container', workspaceId, containerId] }); void qc.invalidateQueries({ queryKey: ['agenda', workspaceId] }); void qc.invalidateQueries({ queryKey: ['container-window', workspaceId, containerId] }) },
    onError: () => void detail.refetch()
  })
  const c = detail.data?.container, tz = c?.timeZone ?? 'UTC'
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const active = c && ['scheduled', 'in_progress'].includes(c.state), paused = c?.state === 'paused'
  return <Sheet open onOpenChange={o => !o && onClose()} title={c?.name ?? 'Container'} description={c && !c.provider ? 'Sem destino' : `Instagram${username ? ` · @${username}` : ''}`}>
    {detail.isLoading && <Spinner label="Carregando Container" />}
    {detail.isError && <FieldError>Não foi possível carregar o Container. <Button size="sm" onClick={() => void detail.refetch()}>Tentar novamente</Button></FieldError>}
    {c && detail.data && <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2"><Badge>{STATE[c.state]}</Badge>{c.delayMin ? <Badge tone="error">+{c.delayMin} min</Badge> : null}{c.counts.waitingQuota > 0 && <Badge>{c.counts.waitingQuota} aguardando quota</Badge>}{c.trialGraduation && <Badge>Reels de teste · {c.trialGraduation === 'MANUAL' ? 'graduação manual' : 'graduação automática'}</Badge>}</div>
      <section aria-label="Progresso do Container" className="grid gap-2">
        <p className="text-sm font-semibold">{c.counts.confirmed} / {c.counts.total}</p>
        <Progress value={c.counts.confirmed / Math.max(1, c.counts.total) * 100} label="Publicações confirmadas" />
        <p className="text-xs text-dim">{c.counts.pending} na fila · {c.counts.running} enviando · {c.counts.failed} com falha · {c.counts.cancelled} cancelado(s)</p>
      </section>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-dim">Início</dt><dd>{when(c.plannedStartAt)}</dd>
        <dt className="text-dim">Fim</dt><dd>{when(c.plannedEndAt)}</dd>
        <dt className="text-dim">Intervalo</dt><dd>{c.intervalMin} min</dd>
        {c.estimatedEndAt && <><dt className="text-dim">Término estimado</dt><dd>{when(c.estimatedEndAt)}</dd></>}
      </dl>
      {control.isError && <FieldError>{control.error instanceof Error ? control.error.message : 'Não foi possível alterar o Container.'}</FieldError>}
      <div className="flex flex-wrap gap-2">
        {c.state === 'draft' && <Button variant="primary" onClick={() => onEdit(c.id)}>Editar</Button>}
        {active && <Button disabled={control.isPending} onClick={() => control.mutate('pause')}>Pausar</Button>}
        {paused && <Button disabled={control.isPending} onClick={() => control.mutate('resume')}>Retomar</Button>}
        {(active || paused) && <Button onClick={() => setRescheduling(r => !r)} aria-expanded={rescheduling}>Reagendar</Button>}
      </div>
      {c.state !== 'draft' && !active && !paused && <p className="text-xs text-dim">Container {STATE[c.state].toLowerCase()}: sem ações de agenda.</p>}
      {paused && <p className="text-xs text-dim">Pausado: nenhum vídeo novo é enviado; confirmações de envios já iniciados continuam.</p>}
      {rescheduling && <ContainerWindowPanel workspaceId={workspaceId} containerId={c.id} name={c.name} />}
      <section aria-label="Vídeos do Container" className="grid gap-1">
        <h3 className="text-xs font-semibold">Vídeos · {detail.data.total}</h3>
        <ol className="grid gap-1">{detail.data.items.map(i => <li key={i.id} className="flex items-center justify-between gap-2 rounded-ctl border border-line px-2 py-1 text-xs">
          <span className="min-w-0 truncate">{i.position + 1}. {i.source.name}</span>
          <span className="shrink-0 text-dim">{when(i.plannedPublishAt)} · {i.confirmed ? 'Publicado' : i.jobState ? JOB[i.jobState] : 'Rascunho'}</span>
        </li>)}</ol>
        {detail.data.total > PAGE && <div className="flex items-center justify-between gap-2"><Button size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anteriores</Button><span className="text-xs text-dim">Página {page} de {Math.ceil(detail.data.total / PAGE)}</span><Button size="sm" disabled={page * PAGE >= detail.data.total} onClick={() => setPage(p => p + 1)}>Próximos</Button></div>}
      </section>
    </div>}
  </Sheet>
}

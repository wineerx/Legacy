import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatQuotaWindow } from '@shared/quota'
import type { DistributionPlan } from '@shared/peak-windows'
import { call } from '../../lib/api'
import { Button, DatePicker, Spinner, Badge } from '../../components/ui'
import { Progress } from '../../components/ui/Progress'
import { FieldError } from '../../components/ui/Field'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/**
 * Preview of peak-window distribution for selected drafts of one destination. Nothing is written until
 * "Aplicar horários"; scheduling stays a separate step per Container, with the quota check of PR 05.
 */
export function DistributionPanel({ workspaceId, containerIds, timeZone, onApplied, onClose }: { workspaceId: string; containerIds: string[]; timeZone: string; onApplied(count: number): void; onClose(): void }) {
  const qc = useQueryClient()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [fromDate, setFromDate] = useState(today)
  const key = ['container-distribution', workspaceId, containerIds.join(','), fromDate]
  const plan = useQuery({ queryKey: key, queryFn: () => call('containers.distribution.plan', { workspaceId, containerIds, fromDate }), staleTime: 0, enabled: Boolean(fromDate) })
  const apply = useMutation({
    mutationFn: (p: DistributionPlan) => call('containers.distribution.apply', { workspaceId, fromDate, items: p.placements.flatMap(v => v.placed ? [{ containerId: v.id, expectedRevision: v.revision, start: v.start }] : []) }),
    onSuccess: result => { void qc.invalidateQueries({ queryKey: ['container-drafts', workspaceId] }); onApplied(result.placements.filter(p => p.placed).length) },
    onError: () => void plan.refetch()
  })
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const data = plan.data, placed = data?.placements.filter(p => p.placed).length ?? 0
  return <section aria-label="Distribuição em horários de pico" className="grid gap-3 rounded-ctl border border-line p-3">
    <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">Distribuir em horários de pico</h3>
      <p className="text-xs text-dim">Na ordem selecionada, cada Container entra inteiro na primeira janela livre, sem mudar o intervalo e sem mover agendamentos existentes. Fuso {timeZone}.</p></div>
      <Button size="sm" onClick={onClose}>Fechar distribuição</Button></div>
    <DatePicker label="A partir de" min={today} value={fromDate} onChange={setFromDate} />
    {plan.isFetching && <Spinner label="Calculando distribuição" />}
    {plan.isError && <FieldError>{plan.error instanceof Error ? plan.error.message : 'Não foi possível calcular a distribuição.'}</FieldError>}
    {data && <>
      <ol className="grid gap-2">{data.placements.map(p => <li key={p.id} className="grid gap-1 rounded-ctl border border-line p-2 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{p.name}</span><Badge>{p.count} vídeo(s) · {p.intervalMin} min</Badge></div>
        {p.placed
          ? <p>{when(p.start)} → {when(p.end)} <span className="text-dim">· janela {data.windows[p.window].start}–{data.windows[p.window].end} ({DAYS[new Date(`${p.date}T12:00:00Z`).getUTCDay()]})</span></p>
          : <p className="text-danger-fg">{p.reason}</p>}
      </li>)}</ol>
      {data.quota.status === 'known' && data.peakInWindow !== null
        ? <div className="grid gap-1 text-xs">
          <p><strong>{data.peakInWindow} / {data.quota.limit}</strong> publicações previstas na janela de {formatQuotaWindow(data.quota.windowSec!)} mais carregada, incluindo as já agendadas.</p>
          <Progress value={data.peakInWindow / data.quota.limit! * 100} label="Uso previsto da quota" />
          <p className="text-dim">Margem operacional: {data.quota.limit! - data.peakInWindow}. Limite informado pela Meta.</p>
        </div>
        : <p className="text-xs text-dim">Quota com capacidade desconhecida. {data.quota.reason ?? ''} A distribuição não considera limite; o agendamento segue a proteção atual.</p>}
      {apply.isError && <FieldError>{apply.error instanceof Error ? apply.error.message : 'Não foi possível aplicar os horários.'}</FieldError>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!placed || apply.isPending || plan.isFetching} onClick={() => apply.mutate(data)}>Aplicar horários aos rascunhos</Button>
        <span className="text-xs text-dim">{placed} de {data.placements.length} Container(s) com horário. Agendar continua sendo uma etapa de cada Container.</span>
      </div>
    </>}
  </section>
}

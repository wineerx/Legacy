import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatQuotaWindow, type QuotaProjection } from '@shared/quota'
import { call } from '../../lib/api'
import { Badge, Button, Spinner, Tooltip } from '../../components/ui'
import { FieldError } from '../../components/ui/Field'

const missing = <Tooltip content="Indisponível"><span tabIndex={0}>—</span></Tooltip>
const value = (n: number | null | undefined) => n === null || n === undefined ? missing : n

/**
 * Quota of the destination account next to the scheduling review. Official usage, local confirmations,
 * remote operations without confirmation and reservations stay separate; unknown capacity is never estimated.
 */
export function QuotaPanel({ workspaceId, accountId, slots, timeZone }: { workspaceId: string; accountId: string; slots: string[]; timeZone: string }) {
  const qc = useQueryClient(), key = ['quota', workspaceId, accountId, slots.join(',')]
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
  const quota = useQuery({ queryKey: key, queryFn: () => call('quota.get', { workspaceId, accountId, slots }), staleTime: 0 })
  const refresh = useMutation({ mutationFn: () => call('quota.refresh', { workspaceId, accountId, slots }), onSuccess: data => qc.setQueryData(key, data) })
  // One automatic reading per account when nothing fresh exists; further readings are explicit.
  const asked = useRef<string | null>(null)
  useEffect(() => {
    const s = quota.data?.snapshot
    if (!quota.data || asked.current === accountId || refresh.isPending) return
    if (!s || (s.freshness !== 'fresh' && s.errorKind !== 'rate_limited')) { asked.current = accountId; refresh.mutate() }
  }, [quota.data, accountId, refresh])
  const data: QuotaProjection | undefined = quota.data
  const s = data?.snapshot
  return <section aria-label="Quota de publicação" className="grid gap-2 rounded-ctl border border-line p-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Quota de publicação · Instagram</h3>
      {s && <Badge tone={s.freshness === 'fresh' ? 'success' : 'default'}>{s.freshness === 'fresh' ? 'Atualizada' : s.freshness === 'stale' ? 'Desatualizada' : 'Indisponível'}</Badge>}
    </div>
    {(quota.isLoading || refresh.isPending) && <Spinner label="Consultando quota" />}
    {quota.isError && <FieldError>Não foi possível calcular a quota. <Button size="sm" onClick={() => void quota.refetch()}>Tentar novamente</Button></FieldError>}
    {refresh.isError && <FieldError>Não foi possível consultar a Meta agora. Os dados abaixo são da última leitura disponível.</FieldError>}
    {data && <>
      {data.status === 'known' ? <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-dim">Consumo informado pela Meta</dt><dd>{s!.usage} de {s!.total} em {formatQuotaWindow(s!.durationSec!)}</dd>
        <dt className="text-dim">Publicadas após a consulta</dt><dd>{data.breakdown.confirmedAfterSnapshot}</dd>
        <dt className="text-dim">Publicações sem confirmação remota</dt><dd>{data.breakdown.uncertainAfterSnapshot}</dd>
        <dt className="text-dim">Já agendadas nesta conta</dt><dd>{data.breakdown.pending}</dd>
        {data.breakdown.candidates > 0 && <><dt className="text-dim">Este Container</dt><dd>{data.breakdown.candidates}</dd></>}
        <dt className="text-dim">Capacidade agora (estimativa)</dt><dd>{value(data.availableNow)}</dd>
      </dl> : <div className="grid gap-1 text-xs">
        <p>Capacidade desconhecida. {data.reason}</p>
        {s?.fetchedAt && <p className="text-dim">Última leitura válida em {when(s.fetchedAt)}: {value(s.usage)} de {value(s.total)} em {s.durationSec ? formatQuotaWindow(s.durationSec) : missing}.</p>}
        <p className="text-dim">O agendamento segue a proteção atual: se a Meta recusar por limite, a fila adia a conta sem consumir tentativas.</p>
      </div>}
      {data.status === 'known' && data.overLimit > 0 && (() => {
        const own = data.slots.filter(v => !v.withinLimit && v.candidate), pushed = data.slots.filter(v => !v.withinLimit && !v.candidate)
        return <p role="alert" className="text-xs text-danger-fg">{own.length > 0 && `${own.length} publicação(ões) deste Container excedem a quota informada; a primeira em ${when(own[0].at)}. `}{pushed.length > 0 && `${pushed.length} publicação(ões) já agendada(s) ficariam além da quota. `}Revise início ou intervalo antes de agendar.</p>
      })()}
      {s?.lastStatus === 'error' && s.errorMessage && <p className="text-xs text-warn">{s.errorMessage}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-dim">{s ? `Última consulta: ${when(s.attemptedAt)}${s.fetchedAt && s.fetchedAt !== s.attemptedAt ? ` · última leitura válida: ${when(s.fetchedAt)}` : ''}` : 'Quota ainda não consultada.'}</span>
        <Button size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate()}>Atualizar quota</Button>
      </div>
    </>}
  </section>
}

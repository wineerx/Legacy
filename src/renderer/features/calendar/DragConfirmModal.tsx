import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarClock, Info } from 'lucide-react'
import type { AgendaItem } from '@shared/agenda'
import { call, ApiError } from '../../lib/api'
import { Button, Modal, Spinner, StatusBadge, useToast } from '../../components/ui'

const span = (min: number) => {
  const sign = min < 0 ? '−' : '+', abs = Math.abs(min), d = Math.floor(abs / 1440), h = Math.floor(abs % 1440 / 60), m = abs % 60
  return `${sign}${[d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '0 min'}`
}

/** Shows what a drop changes before anything moves; applying re-validates the same preview on the backend. */
export function DragConfirmModal({ workspaceId, timeZone, item, startAt, onClose }: { workspaceId: string; timeZone: string; item: AgendaItem; startAt: number; onClose(): void }) {
  const qc = useQueryClient(), toast = useToast()
  const iso = new Date(startAt).toISOString()
  const when = (v: string | null) => v ? new Date(v).toLocaleString('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const preview = useQuery({ queryKey: ['container-drag', workspaceId, item.id, iso], queryFn: () => call('containers.drag.preview', { workspaceId, containerId: item.id, startAt: iso }), staleTime: 0, gcTime: 0 })
  const apply = useMutation({
    mutationFn: () => call('containers.drag.apply', { workspaceId, containerId: item.id, expectedRevision: preview.data!.revision, startAt: iso, slots: preview.data!.slots.map(s => ({ jobId: s.jobId, at: s.at })) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agenda', workspaceId] }); void qc.invalidateQueries({ queryKey: ['container-window'] }); void qc.invalidateQueries({ queryKey: ['agenda-container', workspaceId, item.id] }); void qc.invalidateQueries({ queryKey: ['jobs'] })
      toast.show({ title: 'Container movido', body: `${item.name} começa ${when(iso)}.` }); onClose()
    }
  })
  const p = preview.data
  const warnings = p ? [
    p.quotaDeferred > 0 && `${p.quotaDeferred} vídeo(s) ficam mais tarde que o plano por causa da quota da conta.`,
    p.delayMin ? `Com a quota atual, o término passa ${p.delayMin} min do fim planejado.` : false,
    p.conflicts.length > 0 && `Sobrepõe ${p.conflicts.length} outra(s) programação(ões) desta conta.`,
    p.insidePeak === false && 'Fica fora das janelas de pico configuradas.',
    !p.quotaConsidered && p.slots.length > 0 && 'Quota sem leitura válida: os horários não consideram o limite da Meta.'
  ].filter((w): w is string => Boolean(w)) : []
  return <Modal open onOpenChange={o => { if (!o && !apply.isPending) onClose() }} title={`Mover ${item.name}?`} description={`Instagram${item.username ? ` · @${item.username}` : ''}. Horários no fuso ${timeZone}.`}
    footer={<><Button onClick={onClose} disabled={apply.isPending}>Cancelar</Button><Button variant="primary" loading={apply.isPending} disabledReason={!p ? 'Calculando impacto…' : p.blocked ?? undefined} onClick={() => apply.mutate()}>Confirmar movimentação</Button></>}>
    {preview.isPending && <Spinner label="Calculando impacto" />}
    {preview.isError && <p role="alert" className="text-sm text-danger-fg">Não foi possível calcular o impacto. {preview.error instanceof ApiError ? preview.error.message : ''}</p>}
    {p && <div className="grid gap-4" aria-label="Impacto da movimentação">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-ctl border border-line bg-side p-3 text-sm">
        <div><p className="text-[11px] text-dim">Agora</p><p className="font-medium">{when(p.before.startAt)}</p><p className="text-xs text-dim">até {when(p.before.endAt)}</p></div>
        <ArrowRight size={16} aria-hidden className="text-dim" />
        <div><p className="text-[11px] text-dim">Depois</p><p className="font-medium">{when(p.after.startAt)}</p><p className="text-xs text-dim">até {when(p.after.endAt)}</p></div>
      </div>
      {p.blocked ? <p role="alert" className="flex items-start gap-2 text-sm text-warn"><Info size={15} className="mt-0.5 shrink-0" aria-hidden />{p.blocked}</p> : <>
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusBadge tone="blue"><CalendarClock size={11} aria-hidden />{span(p.deltaMin)}</StatusBadge>
          <StatusBadge tone="neutral">{p.slots.length} vídeo(s) reagendado(s)</StatusBadge>
          {p.unchanged.published > 0 && <StatusBadge tone="green">{p.unchanged.published} publicado(s) não mudam</StatusBadge>}
          {p.unchanged.inFlight > 0 && <StatusBadge tone="orange">{p.unchanged.inFlight} em envio não mudam</StatusBadge>}
          {p.unchanged.failed > 0 && <StatusBadge tone="red">{p.unchanged.failed} com falha não mudam</StatusBadge>}
        </div>
        {warnings.length > 0 ? <ul className="grid gap-1.5">{warnings.map(w => <li key={w} className="flex items-start gap-2 text-xs text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />{w}</li>)}</ul>
          : <p className="text-xs text-dim">Sem conflitos com outras programações da conta{p.insidePeak ? ', dentro de uma janela de pico' : ''}. Término estimado {when(p.after.estimatedEndAt)}.</p>}
        <div className="max-h-52 overflow-y-auto rounded-ctl border border-line">
          <table className="ds-table"><caption className="sr-only">Horários antes e depois</caption><thead><tr><th>#</th><th>Antes</th><th>Depois</th></tr></thead>
            <tbody>{p.slots.map((s, i) => <tr key={s.jobId}><td className="tabular-nums text-dim">{i + 1}</td><td className="tabular-nums">{when(s.before)}</td><td className="tabular-nums">{when(s.at)}</td></tr>)}</tbody></table>
        </div>
        <p className="text-xs text-dim">Legendas, mídia, receitas e o histórico do Container não mudam. A alteração fica registrada nos ajustes do Container.</p>
      </>}
      {apply.isError && <p role="alert" className="text-sm text-danger-fg">{apply.error instanceof ApiError ? apply.error.message : 'Não foi possível mover o Container.'}</p>}
    </div>}
  </Modal>
}

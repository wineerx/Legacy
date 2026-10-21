import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import type { Proposal } from '@shared/container-window'
import { call } from '../../lib/api'
import { Button, Spinner, Badge, Modal } from '../../components/ui'
import { Progress } from '../../components/ui/Progress'
import { FieldError } from '../../components/ui/Field'

const KIND = { keep: 'Manter intervalo', reduce: 'Reduzir intervalo', move: 'Mover restante', drag: 'Movido no Calendário' } as const
const span = (min: number) => min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`

/** Planned window versus current estimate of a scheduled Container, with explicit adjustment choices (PR 07). */
export function ContainerWindowPanel({ workspaceId, containerId, name, onBack }: { workspaceId: string; containerId: string; name: string; onBack?(): void }) {
  const qc = useQueryClient(), key = ['container-window', workspaceId, containerId]
  const view = useQuery({ queryKey: key, queryFn: () => call('containers.window.get', { workspaceId, containerId }), refetchInterval: 60_000 })
  const [choice, setChoice] = useState<Proposal | null>(null), [notice, setNotice] = useState('')
  const apply = useMutation({
    mutationFn: (p: Proposal) => call('containers.window.adjust', { workspaceId, containerId, expectedRevision: view.data!.revision, kind: p.kind, slots: p.kind === 'keep' ? [] : p.slots }),
    onSuccess: (data, p) => { qc.setQueryData(key, data); void qc.invalidateQueries({ queryKey: ['container-scheduled', workspaceId] }); setChoice(null)
      setNotice(p.kind === 'keep' ? 'Intervalo mantido. Nenhum horário foi alterado.' : 'Ajuste aplicado aos vídeos ainda não enviados. Os demais seguem como estavam.') },
    onError: () => void view.refetch()
  })
  const d = view.data, w = d?.window, tz = d?.timeZone ?? 'UTC'
  const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const describe = (p: Proposal) => p.kind === 'keep' ? `Mantém os horários atuais. Término estimado ${when(p.estimatedEndAt)}${p.delayMin ? `, ${span(p.delayMin)} além da janela` : ''}.`
    : p.kind === 'reduce' ? `${p.slots.length} vídeo(s) a cada ${p.intervalMin} min a partir de ${when(p.slots[0].at)}. Término ${when(p.estimatedEndAt)}${p.delayMin ? `, ainda ${span(p.delayMin)} além` : ', dentro da janela'}.`
      : `${p.slots.length} vídeo(s) para a janela ${p.window.start}–${p.window.end}: ${when(p.startAt)} → ${when(p.estimatedEndAt)}, com o mesmo intervalo. O fim planejado passa a ser esse horário.`
  return <section aria-label="Janela do Container" className="grid gap-3">
    {onBack && <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3><Button size="sm" onClick={onBack}>Voltar aos agendados</Button></div>}
    {view.isLoading && <Spinner label="Calculando janela" />}
    {view.isError && <FieldError>Não foi possível calcular a janela. <Button size="sm" onClick={() => void view.refetch()}>Tentar novamente</Button></FieldError>}
    {notice && <p role="status" className="text-xs text-dim">{notice}</p>}
    {d && w && <>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-dim">Janela planejada</dt><dd>{w.plannedStartAt && w.plannedEndAt ? `${when(w.plannedStartAt)} → ${when(w.plannedEndAt)}` : '—'}</dd>
        <dt className="text-dim">Publicados</dt><dd>{w.published} de {w.published + w.remaining + w.failed}{w.failed ? ` · ${w.failed} com falha` : ''}</dd>
        <dt className="text-dim">Término estimado</dt><dd>{w.estimatedEndAt ? when(w.estimatedEndAt) : w.status === 'paused' ? 'Suspenso durante a pausa' : '—'}</dd>
        {w.estimatedEndAt && <><dt className="text-dim">Termina em</dt><dd>{span(Math.max(0, Math.ceil((Date.parse(w.estimatedEndAt) - Date.now()) / 60_000)))}</dd></>}
      </dl>
      <Progress value={(w.published / Math.max(1, w.published + w.remaining + w.failed)) * 100} label="Publicados no Container" />
      {w.status === 'late' && <p role="alert" className="flex items-center gap-2 text-xs text-danger-fg"><AlertTriangle size={14} aria-hidden />O Container ultrapassará sua janela em {span(w.delayMin!)}.</p>}
      {w.status === 'on_time' && <Badge tone="success">Dentro da janela</Badge>}
      {w.status === 'paused' && <p className="text-xs text-dim">Container pausado: nenhum vídeo novo é enviado e a estimativa fica suspensa até retomar.</p>}
      {w.status === 'finished' && <p className="text-xs text-dim">Todos os vídeos já foram concluídos.</p>}
      {w.overdue > 0 && <p className="text-xs text-warn">{w.overdue} vídeo(s) com horário vencido aguardando o processador.</p>}
      {w.inFlight > 0 && <p className="text-xs text-dim">{w.inFlight} vídeo(s) em envio não são alterados por ajustes.</p>}
      <p className="text-[11px] text-dim">{w.quotaConsidered ? `Estimativa considera a quota informada pela Meta${d.quota.fetchedAt ? ` (consulta de ${when(d.quota.fetchedAt)})` : ''}.` : 'Estimativa sem quota: leitura ausente ou desatualizada.'}</p>
      {d.proposals.proposals.length > 0 && <div className="grid gap-2"><h4 className="text-xs font-semibold">Como seguir</h4>
        {d.proposals.proposals.map(p => <div key={p.kind} className="grid gap-1 rounded-ctl border border-line p-2"><Button size="sm" onClick={() => setChoice(p)}>{KIND[p.kind]}</Button><p className="text-xs text-dim">{describe(p)}</p></div>)}
        {d.proposals.unavailable.map(u => <p key={u.kind} className="text-xs text-dim">{KIND[u.kind]}: {u.reason}</p>)}
      </div>}
      {d.adjustments.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-dim">Ajustes registrados ({d.adjustments.length})</summary>
        <ul className="mt-2 grid gap-1">{d.adjustments.map(a => <li key={a.id}>{when(a.createdAt)} · {KIND[a.kind]}{a.kind === 'reduce' ? `: ${a.before.intervalMin} → ${a.after.intervalMin} min` : a.kind === 'move' && a.after.plannedEndAt ? `: fim planejado ${when(a.after.plannedEndAt)}` : a.kind === 'drag' && a.after.plannedStartAt ? `: início ${when(a.before.plannedStartAt ?? a.after.plannedStartAt)} → ${when(a.after.plannedStartAt)}` : ''}</li>)}</ul></details>}
    </>}
    <Modal open={!!choice} onOpenChange={o => !o && setChoice(null)} title={choice ? `${KIND[choice.kind]}?` : ''} description={choice ? describe(choice) : ''}
      footer={<><Button onClick={() => setChoice(null)}>Voltar</Button><Button variant="primary" disabled={apply.isPending} onClick={() => choice && apply.mutate(choice)}>Confirmar ajuste</Button></>}>
      {apply.isError && <FieldError>{apply.error instanceof Error ? apply.error.message : 'Não foi possível aplicar o ajuste.'}</FieldError>}
      <p className="text-xs text-dim">Somente vídeos ainda não enviados mudam. Conteúdo, legendas e receitas congelados permanecem iguais; a quota da conta é verificada novamente.</p>
    </Modal>
  </section>
}

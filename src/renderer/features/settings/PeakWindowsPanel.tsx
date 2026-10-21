import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { peakWindows, type PeakWindow } from '@shared/peak-windows'
import { call } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, Spinner, TimePicker, EmptyState } from '../../components/ui'
import { FieldError } from '../../components/ui/Field'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const ALL = [0, 1, 2, 3, 4, 5, 6]

/** Peak windows of the workspace. Nothing is pre-filled: the user decides the hours. */
export function PeakWindowsPanel() {
  const { workspace } = useWorkspace(), qc = useQueryClient(), key = ['peak-windows', workspace.id]
  const query = useQuery({ queryKey: key, queryFn: () => call('scheduler.windows.get', { workspaceId: workspace.id }) })
  const [draft, setDraft] = useState<PeakWindow[] | null>(null)
  useEffect(() => { if (query.data && draft === null) setDraft(query.data.windows) }, [query.data, draft])
  const save = useMutation({ mutationFn: (windows: PeakWindow[]) => call('scheduler.windows.save', { workspaceId: workspace.id, windows }), onSuccess: data => { qc.setQueryData(key, data); setDraft(data.windows) } })
  const list = draft ?? []
  const check = peakWindows.safeParse(list)
  const dirty = query.data && JSON.stringify(query.data.windows) !== JSON.stringify(list)
  const set = (i: number, patch: Partial<PeakWindow>) => setDraft(list.map((w, j) => j === i ? { ...w, ...patch } : w))
  return <section aria-label="Janelas de pico" className="grid gap-4 rounded-card border border-line bg-panel p-6 text-sm">
    <div><h2 className="font-semibold">Janelas de pico</h2>
      <p className="mt-1 text-xs text-dim">Horários em que os Containers podem ser distribuídos, no fuso {query.data?.timeZone ?? workspace.timeZone}. Uma janela com fim antes do início atravessa a meia-noite e pertence ao dia em que começa.</p></div>
    {query.isLoading && <Spinner label="Carregando janelas" />}
    {query.isError && <FieldError>Não foi possível carregar as janelas. <Button size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></FieldError>}
    {draft && !list.length && <EmptyState icon={null} title="Nenhuma janela configurada" body="Sem janelas, a distribuição não sugere horários. O agendamento manual continua disponível." />}
    <ol className="grid gap-3">{list.map((w, i) => <li key={i} className="grid gap-3 rounded-ctl border border-line p-3">
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <TimePicker label={`Início da janela ${i + 1}`} value={w.start} onChange={start => set(i, { start })} />
        <TimePicker label={`Fim da janela ${i + 1}`} value={w.end} onChange={end => set(i, { end })} />
        <Button size="sm" onClick={() => setDraft(list.filter((_, j) => j !== i))}>Remover janela {i + 1}</Button>
      </div>
      <ToggleGroup.Root type="multiple" aria-label={`Dias da janela ${i + 1}`} value={w.weekdays.map(String)} onValueChange={days => set(i, { weekdays: days.map(Number).sort() })} className="flex flex-wrap gap-2">
        {DAYS.map((d, n) => <ToggleGroup.Item key={d} value={String(n)} aria-label={d} className="rounded-ctl border border-line px-3 py-1 text-xs data-[state=on]:bg-fg data-[state=on]:text-app">{d}</ToggleGroup.Item>)}
      </ToggleGroup.Root>
      {w.start && w.end && w.end < w.start && <p className="text-xs text-dim">Atravessa a meia-noite: termina às {w.end} do dia seguinte.</p>}
    </li>)}</ol>
    {draft && !check.success && <FieldError>{check.error.issues[0].message}</FieldError>}
    {save.isError && <FieldError>{save.error instanceof Error ? save.error.message : 'Não foi possível salvar as janelas.'}</FieldError>}
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!draft || list.length >= 12} onClick={() => setDraft([...list, { start: '', end: '', weekdays: ALL }])}>Adicionar janela</Button>
      <Button variant="primary" disabled={!dirty || !check.success || save.isPending} onClick={() => save.mutate(list)}>Salvar janelas</Button>
      {save.isSuccess && !dirty && <span role="status" className="text-xs text-dim">Janelas salvas.</span>}
    </div>
  </section>
}

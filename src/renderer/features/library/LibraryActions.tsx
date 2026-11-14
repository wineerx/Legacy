import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ellipsis, FolderOpen, ListOrdered, SlidersHorizontal, Upload } from 'lucide-react'
import { call } from '../../lib/api'
import { Button, Dropdown, DropdownClose, Spinner, cx, type FilterPanelState } from '../../components/ui'
import { Sheet } from '../../components/ui/Sheet'

const STATE_LABELS = { running: 'Processando…', queued: 'Aguardando', failed: 'Falhou' } as const

type Props = {
  workspaceId: string
  importing: boolean
  panel: FilterPanelState
  onImport(): void
  onOpenDrafts(): void
  onOpenQueue(): void
}

export function LibraryActions({ workspaceId, importing, panel, onImport, onOpenDrafts, onOpenQueue }: Props) {
  const [open, setOpen] = useState(false)
  const pending = useQuery({ queryKey: ['library-pending', workspaceId], queryFn: () => call('library.pending', { workspaceId }), refetchInterval: 2000 })
  const jobs = pending.data ?? []
  const running = jobs.some(j => j.state === 'running')
  const failed = jobs.filter(j => j.state === 'failed').length
  const name = jobs.length ? `Fila de mídia, ${jobs.length} tarefa(s)${failed ? `, ${failed} com falha` : ''}` : 'Fila de mídia'
  return <>
    <Dropdown trigger={
      <button type="button" aria-label="Ações da biblioteca" title="Ações da biblioteca" data-tour="library-import" className="ds-filter-trigger relative">
        <Ellipsis size={16} aria-hidden />
        {failed > 0 && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-danger-icon" />}
      </button>
    }>
      <DropdownClose asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Upload size={14} />} disabled={importing} onClick={onImport}>Importar vídeos</Button>
      </DropdownClose>
      <DropdownClose asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start" icon={<FolderOpen size={14} />} onClick={onOpenDrafts}>Containers em rascunho</Button>
      </DropdownClose>
      <DropdownClose asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start" aria-label={name} icon={running ? <Spinner label="Processando mídia" /> : <ListOrdered size={14} aria-hidden />} onClick={() => setOpen(true)}>
          Fila de mídia
          {jobs.length > 0 && <span aria-hidden className="ds-filter-count">{jobs.length}</span>}
        </Button>
      </DropdownClose>
      <DropdownClose asChild>
        <Button size="sm" variant="ghost" className="w-full justify-start" icon={<SlidersHorizontal size={14} />} aria-expanded={panel.open} aria-controls={panel.open ? panel.panelId : undefined} onClick={() => panel.setOpen(!panel.open)}>
          {panel.open ? 'Ocultar painel de filtros' : 'Mostrar painel de filtros'}
        </Button>
      </DropdownClose>
    </Dropdown>
    <Sheet open={open} onOpenChange={setOpen} title="Fila de mídia" description="Downloads e miniaturas recentes da Biblioteca.">
      {pending.isError ? <p role="alert" className="text-sm text-danger-fg">Fila de mídia indisponível. <button type="button" className="underline" onClick={() => void pending.refetch()}>Tentar novamente</button></p>
        : !jobs.length ? <p className="text-sm text-dim">{pending.isLoading ? 'Carregando…' : 'Nenhuma tarefa de mídia em andamento.'}</p>
        : <ul aria-label="Tarefas de mídia" className="divide-y divide-line">
          {jobs.map(job => <li key={job.id} className="grid gap-1 py-3 text-sm">
            <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{job.label}</span>
              <span className={cx('shrink-0 text-xs', job.state === 'failed' ? 'text-danger-fg' : 'text-dim')}>{STATE_LABELS[job.state]}</span></div>
            {job.error && <p className="text-xs text-danger-fg">{job.error}</p>}
          </li>)}
        </ul>}
      <Button className="mt-4" onClick={() => { setOpen(false); onOpenQueue() }}>Abrir Fila completa</Button>
    </Sheet>
  </>
}

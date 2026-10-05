import { useEffect, useState, type DragEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Star, Trash2, Library } from 'lucide-react'
import type { ImportResultDto } from '@shared/ipc-contract'
import type { GridItem } from '@shared/types'
import { call, pathForFile, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, Modal, Pills, useToast, cx } from '../../components/ui'
import { MediaPreview } from '../../components/MediaPreview'
import { MediaGrid } from '../../components/MediaGrid'
import { useGridQuery } from '../profiles/useGridQuery'
import { emptySelection, toggleId, selectPage, selectAllFiltered, selectionLabel, selectionCount, resolveSelectedIds, setComposeSelection, type Selection } from '../../lib/selection'
import type { PageProps } from '../../routes'
import { ImportResultsModal } from './ImportResultsModal'

type Sort = 'importedAt' | 'durationMs'

export function LibraryPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [preview, setPreview] = useState<GridItem | null>(null)
  const qc = useQueryClient()
  const [sortBy, setSortBy] = useState<Sort>('importedAt')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [selection, setSelection] = useState<Selection>(emptySelection())
  const [results, setResults] = useState<ImportResultDto[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toDelete, setToDelete] = useState<GridItem | null>(null)
  const q = { workspaceId: workspace.id, source: 'library' as const, sortBy, sortDir: 'desc' as const, favoritesOnly: favoritesOnly || undefined }
  const grid = useGridQuery(q)

  useEffect(() => { setSelection(emptySelection()) }, [sortBy, favoritesOnly])

  const onDone = (r: ImportResultDto[]) => {
    void qc.invalidateQueries()
    if (r.length && r.some((x) => x.status !== 'imported' || x.warnings.length || x.errors.length)) setResults(r)
    else if (r.length) toast.show({ title: `${r.length} vídeo(s) importado(s)` })
  }
  const onError = (e: unknown) => toast.show({ title: 'Não foi possível importar', body: e instanceof ApiError ? e.message : undefined, tone: 'error' })
  const pick = useMutation({ mutationFn: () => call('library.pickAndImport', { workspaceId: workspace.id }), onSuccess: onDone, onError })
  const byPaths = useMutation({ mutationFn: (paths: string[]) => call('library.importPaths', { workspaceId: workspace.id, paths }), onSuccess: onDone, onError })
  const fav = useMutation({ mutationFn: (i: GridItem) => call('library.setFavorite', { workspaceId: workspace.id, id: i.id, favorite: !i.badges.includes('favorito') }), onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast.show({ title: 'Não foi possível favoritar', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }) })
  const del = useMutation({ mutationFn: (id: string) => call('library.delete', { workspaceId: workspace.id, id }), onSuccess: (_r, id) => {
      setToDelete(null)
      setSelection((s) => { if (s.mode !== 'ids' || !s.ids.has(id)) return s; const ids = new Set(s.ids); ids.delete(id); return { mode: 'ids', ids } })
      void qc.invalidateQueries()
    },
    onError: (e) => toast.show({ title: 'Não foi possível excluir', body: e instanceof ApiError ? e.message : undefined, tone: 'error' }) })

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files).map(pathForFile).filter(Boolean)
    if (paths.length) byPaths.mutate(paths)
  }
  const prepare = async () => {
    setComposeSelection(await resolveSelectedIds(selection, q))
    navigate('compose')
  }
  const importButton = <Button data-tour="library-import" variant="primary" icon={<Upload size={14} />} onClick={() => pick.mutate()}>Importar vídeos</Button>

  return (
    <div data-testid="drop-zone" className={cx('flex min-h-full flex-col gap-4 p-6', dragging && 'outline-2 outline-dashed outline-dim -outline-offset-8')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Biblioteca</h1>
          <p className="text-xs text-dim">{grid.loadedNote || 'Seus vídeos ficam guardados neste computador.'} Arraste arquivos para cá ou use o botão.</p>
        </div>
        {importButton}
      </header>
      <div data-tour="library-selection" className="flex flex-wrap items-center gap-2">
        <Pills<Sort> label="Ordenar" value={sortBy} onChange={setSortBy} options={[{ value: 'importedAt', label: 'Mais recentes' }, { value: 'durationMs', label: 'Mais longos' }]} />
        <Pills label="Filtro" value={favoritesOnly ? 'fav' : 'all'} onChange={(v) => setFavoritesOnly(v === 'fav')} options={[{ value: 'all', label: 'Todos' }, { value: 'fav', label: 'Favoritos' }]} />
        <span className="ml-auto text-xs text-dim">{selectionLabel(selection)}</span>
        <Button size="sm" variant="ghost" onClick={() => setSelection(selectPage(selection, grid.items.map((i) => i.id)))}>Selecionar página</Button>
        {grid.total > grid.items.length && <Button size="sm" variant="ghost" onClick={() => setSelection(selectAllFiltered(grid.total))}>Selecionar todos os {grid.total}</Button>}
        {selectionCount(selection) > 0 && <Button size="sm" variant="ghost" onClick={() => setSelection(emptySelection())}>Limpar</Button>}
        <Button size="sm" variant="primary" disabledReason={selectionCount(selection) === 0 ? 'Selecione ao menos um vídeo.' : undefined} onClick={prepare}>Preparar lote</Button>
      </div>
      {grid.isError && <p className="text-sm text-danger-fg">Não foi possível carregar a biblioteca. {grid.error instanceof ApiError ? grid.error.message : ''}</p>}
      {!grid.isLoading && grid.items.length === 0 && !grid.isError
        ? <EmptyState icon={<Library size={28} />} title="Comece pela biblioteca" body="Importe vídeos do seu computador. Eles ficam guardados aqui, e o original nunca é alterado." action={importButton} />
        : <MediaGrid items={grid.items} loading={grid.isLoading} selection={selection} onToggleSelect={(id) => setSelection(toggleId(selection, id))}
            onOpen={setPreview} onEndReached={grid.hasNextPage ? () => void grid.fetchNextPage() : undefined}
            renderActions={(i) => (
              <>
                <Button size="sm" variant="secondary" aria-label={i.badges.includes('favorito') ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => fav.mutate(i)}><Star size={12} /></Button>
                <Button size="sm" variant="secondary" aria-label="Excluir" onClick={() => setToDelete(i)}><Trash2 size={12} /></Button>
              </>
            )} />}
      {preview && <MediaPreview key={preview.id} item={preview} onClose={() => setPreview(null)} />}
      <ImportResultsModal results={results} onClose={() => setResults(null)} />
      <Modal open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title="Excluir vídeo?"
        description="O vídeo, a capa e as versões editadas serão apagados deste computador. O arquivo original que você importou continua na pasta de origem."
        footer={<><Button onClick={() => setToDelete(null)}>Cancelar</Button><Button variant="danger" onClick={() => toDelete && del.mutate(toDelete.id)}>Excluir</Button></>} />
    </div>
  )
}

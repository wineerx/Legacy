import { useRepostConfirmation } from '../compose/useRepostConfirmation'
import { takeLibraryFocus } from '../../lib/selection'
import { MEDIA_STATE_LABELS } from '@shared/types'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Star, Trash2, Library, Grid2X2, List, Image } from 'lucide-react'
import type { ImportResultDto } from '@shared/ipc-contract'
import type { GridItem } from '@shared/types'
import { call, pathForFile, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, Input, Modal, useToast, cx, FilterSearch, FilterFields, FilterPanel, useFilterPanel, Pagination, Segmented, SortMenu, SelectionBar, Tooltip } from '../../components/ui'
import { MediaPreview } from '../../components/MediaPreview'
import { MediaGrid } from '../../components/MediaGrid'
import { useMediaPreferences } from '../../lib/media-preferences'
import { mediaUrl } from '../../lib/api'
import { DeliveryTime, deliveryError } from '../../components/ui'
import { zonedToUtc } from '@shared/schedule'
import { formatDuration } from '@shared/format'
import { emptySelection, toggleId, selectPage, selectAllFiltered, selectionLabel, selectionCount, resolveSelectedIds, setComposeSelection, type Selection } from '../../lib/selection'
import type { PageProps } from '../../routes'
import { MediaActions } from './MediaActions'
import { ImportResultsModal } from './ImportResultsModal'
import { ContainerDraftSheet, type DraftSheetRequest } from './ContainerDraftSheet'
import { libraryVideo, topLibraryVideos } from './container-draft'
import { useLibraryFilters } from './library-filters'
import { LibraryActions } from './LibraryActions'

type Sort = 'importedAt' | 'durationMs' | 'views' | 'likes' | 'comments'

export function LibraryPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [preview, setPreview] = useState<GridItem | null>(null)
  const qc = useQueryClient()
  const [sortBy, setSortBy] = useState<Sort>('importedAt')
  const [selection, setSelection] = useState<Selection>(emptySelection())
  const [topN, setTopN] = useState('12')
  const [draftRequest, setDraftRequest] = useState<(DraftSheetRequest & { key: string }) | null>(null)
  const selectedMedia = useRef(new Map<string, GridItem>())
  const [results, setResults] = useState<ImportResultDto[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const prefs = useMediaPreferences()
  const [pageNo, setPageNo] = useState(1), [pageSize, setPageSize] = useState(60)
  const offset = (pageNo - 1) * pageSize
  const setOffset = (value: number) => setPageNo(Math.floor(value / pageSize) + 1)
  const [focusedAsset, setFocusedAsset] = useState(() => takeLibraryFocus(workspace.id))
  const filterOptions = useQuery({ queryKey: ['library-filter-options', workspace.id], queryFn: () => call('library.filterOptions', { workspaceId: workspace.id }), refetchInterval: 15_000 })
  const filters = useLibraryFilters(workspace.timeZone, filterOptions.data)
  const panel = useFilterPanel('legacy.library.filters', true)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [scheduleItem, setScheduleItem] = useState<GridItem | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [toDelete, setToDelete] = useState<GridItem | null>(null)
  const q = { assetId: focusedAsset?.assetId, publicationJobId: focusedAsset?.publicationJobId, workspaceId: workspace.id, source: 'library' as const, sortBy, sortDir: 'desc' as const, ...filters.query }
  const queryIdentity = JSON.stringify(q)
  const latestQuery = useRef(queryIdentity)
  latestQuery.current = queryIdentity
  const page = useQuery({ queryKey: ['grid', q, offset, pageSize], queryFn: () => call('grid.query', { ...q, limit: pageSize, offset }), refetchInterval: 3000 })
  useEffect(() => { for (const item of page.data?.items ?? []) selectedMedia.current.set(item.id, item) }, [page.data])
  const selectTop = useMutation({ mutationFn: async () => ({ items: await topLibraryVideos(q, Number(topN)), identity: queryIdentity }), onSuccess: ({ items, identity }) => {
    if (latestQuery.current !== identity) return
    for (const item of items) selectedMedia.current.set(item.id, item)
    setSelection({ mode: 'ids', ids: new Set(items.map(i => i.id)) })
  }, onError: e => toast.show({ title: 'Não foi possível selecionar Top N', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const openContainer = useMutation({ mutationFn: async (mode: 'new' | 'append') => {
    const ids = await resolveSelectedIds(selection, q)
    if (!ids.length || ids.length > 1000) throw new Error('Selecione entre 1 e 1.000 vídeos.')
    const videos: GridItem[] = []
    for (let n = 0; n < ids.length; n += 8) videos.push(...await Promise.all(ids.slice(n, n + 8).map(id => selectedMedia.current.get(id) ?? libraryVideo(workspace.id, id))))
    return { mode, videos, identity: queryIdentity }
  }, onSuccess: result => {
    if (latestQuery.current !== result.identity) return
    setDraftRequest({ mode: result.mode, videos: result.videos, key: crypto.randomUUID() })
  }, onError: e => toast.show({ title: 'Não foi possível abrir o Container', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const grid = { items: page.data?.items ?? [], total: page.data?.total ?? 0, isError: page.isError, error: page.error, isLoading: page.isLoading }
  const account = useQuery({ queryKey: ['instagram-account', workspace.id], queryFn: () => call('accounts.instagram', { workspaceId: workspace.id }) })
  const repost = useRepostConfirmation(workspace.id, account.data?.id)
  const schedule = useMutation({ mutationFn: (allowRepost: boolean = false) => { const [date, time] = scheduleAt.split('T'); return call('profiles.scheduleInstagram', { workspaceId: workspace.id, postIds: [scheduleItem!.postId!], firstAt: zonedToUtc(date, time, workspace.timeZone).toISOString(), intervalMin: 60, allowRepost, cleanupAfterPublish: false, shareToFeed: true }) }, onSuccess: () => { setScheduleItem(null); void qc.invalidateQueries(); navigate('queue') }, onError: e => toast.show({ title: 'Não foi possível agendar', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const saveCopy = useMutation({ mutationFn: (id: string) => call('library.saveCopy', { workspaceId: workspace.id, id }), onSuccess: result => result.saved && toast.show({ title: 'Cópia salva' }), onError: e => toast.show({ title: 'Não foi possível salvar', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const bulkDelete = useMutation({ mutationFn: () => call('library.deleteMany', { workspaceId: workspace.id, ids: deleteIds! }), onSuccess: result => {
    setDeleteIds(null); setSelection(emptySelection()); void qc.invalidateQueries()
    toast.show({ title: `${result.deleted.length} vídeo(s) excluído(s)`, body: `${result.blocked.length} em uso preservados; ${result.failed.length} falhas.`, tone: result.failed.length ? 'error' : 'info' })
  }, onError: e => toast.show({ title: 'Não foi possível excluir', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const filterIdentity = JSON.stringify(filters.query)
  useEffect(() => { setOffset(0); setSelection(emptySelection()) }, [sortBy, filterIdentity])
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
  const importing = pick.isPending || byPaths.isPending
  const importButton = <Button variant="primary" icon={<Upload size={14} />} disabled={importing} onClick={() => pick.mutate()}>Importar vídeos</Button>

  return (
    <div data-testid="drop-zone" className={cx('flex h-full w-full min-w-0 overflow-hidden', dragging && 'outline-2 outline-dashed outline-dim -outline-offset-8')}
      onDragOver={(e) => { if (!Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <FilterPanel state={panel} groups={filters.groups} count={filters.count} onClearAll={filters.clear} total={grid.isLoading ? null : grid.total} noun="vídeos" storageKey="legacy.library.filtersWidth" side="left" searchable={false} plain />
     <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      {focusedAsset && <div role="status" className="ds-summary flex items-center justify-between gap-3"><span>Mostrando somente o vídeo desta publicação.</span><Button size="sm" onClick={() => setFocusedAsset(undefined)}>Limpar filtro do vídeo</Button></div>}
      <div role="search" aria-label="Filtrar biblioteca" className="ds-filter-toolbar">
        <FilterSearch label="Buscar mídia" placeholder="Nome, perfil, legenda ou origem" value={filters.text} onChange={filters.setText} className="ds-filter-toolbar-search" />
        <FilterFields state={panel} groups={filters.groups.filter(group => !['state', 'period', 'favorites'].includes(group.id))} />
        <div className="ds-filter-toolbar-actions">
          <SortMenu<Sort> value={sortBy} onChange={setSortBy} options={[{ value: 'importedAt', label: 'Mais recentes' }, { value: 'durationMs', label: 'Mais longos' }, { value: 'views', label: 'Mais vistos' }, { value: 'likes', label: 'Mais curtidos' }, { value: 'comments', label: 'Mais comentados' }]} />
          <Segmented<'grid' | 'list'> label="Visualização" value={prefs.list ? 'list' : 'grid'} onChange={v => prefs.save.mutate({ key: 'mediaViewList', value: v === 'list' })} options={[{ value: 'grid', label: '', icon: <Grid2X2 size={14} aria-hidden />, ariaLabel: 'Visualização em grade' }, { value: 'list', label: '', icon: <List size={14} aria-hidden />, ariaLabel: 'Visualização em lista' }]} />
          <Tooltip content="Exibir banner nas miniaturas"><button type="button" aria-label="Exibir banner nas miniaturas" aria-pressed={prefs.showBanner} onClick={() => prefs.save.mutate({ key: 'mediaShowBanner', value: !prefs.showBanner })} className="ds-filter-trigger ds-filter-toggle"><Image size={14} aria-hidden /></button></Tooltip>
          <LibraryActions workspaceId={workspace.id} importing={importing} panel={panel} onImport={() => pick.mutate()}
            onOpenDrafts={() => setDraftRequest({ mode: 'manage', videos: [], key: crypto.randomUUID() })}
            onOpenQueue={() => navigate('queue')} />
        </div>
      </div>
      {/* Actions on the selection appear only when something is selected, instead of a row of disabled buttons. */}
      <div data-tour="library-selection"><SelectionBar count={selectionCount(selection)} label={selectionLabel(selection)} onClear={() => setSelection(emptySelection())}
        helpers={<>
          <Button size="sm" variant="ghost" onClick={() => setSelection(selectPage(selection, grid.items.map((i) => i.id)))}>Selecionar página</Button>
          <span aria-hidden className="h-5 w-px bg-line" />
          <span className="text-xs text-dim">Melhores</span>
          <Input aria-label="Quantidade Top N" type="number" min={1} max={1000} value={topN} onChange={e => setTopN(e.target.value)} className="w-24" />
          <Button size="sm" disabled={selectTop.isPending || openContainer.isPending || grid.isLoading} onClick={() => selectTop.mutate()}>Selecionar Top N</Button>
        </>}
        actions={<>
          <Button size="sm" variant="primary" disabled={openContainer.isPending || selectTop.isPending} disabledReason={selectionCount(selection) > 1000 ? 'Use até 1.000 vídeos por Container.' : undefined} onClick={() => openContainer.mutate('new')}>Criar novo Container</Button>
          <Button size="sm" disabled={openContainer.isPending || selectTop.isPending} disabledReason={selectionCount(selection) > 1000 ? 'Use até 1.000 vídeos por Container.' : undefined} onClick={() => openContainer.mutate('append')}>Adicionar ao Container</Button>
          <Button size="sm" disabledReason={selectionCount(selection) > 100 ? 'Prepare até 100 vídeos por lote.' : undefined} onClick={prepare}>Preparar lote</Button>
          <Button size="sm" variant="danger" disabledReason={selectionCount(selection) > 200 ? 'Exclua até 200 arquivos por vez.' : undefined} onClick={() => selection.mode === 'ids' && setDeleteIds([...selection.ids])}><Trash2 size={12} />Excluir selecionados</Button>
        </>} /></div>
      {importing && <p role="status" className="rounded-ctl border border-line p-3 text-xs">Importando e verificando arquivos…</p>}
      {grid.isError && <p className="text-sm text-danger-fg">Não foi possível carregar a biblioteca. {grid.error instanceof ApiError ? grid.error.message : ''}</p>}
      {!grid.isLoading && grid.items.length === 0 && !grid.isError
        ? <EmptyState icon={<Library size={28} />} title={filters.active ? 'Nenhuma mídia encontrada' : 'Comece pela biblioteca'} body={filters.active ? 'Ajuste os filtros para encontrar outros conteúdos.' : 'Importe vídeos do seu computador. Eles ficam guardados aqui, e o original nunca é alterado.'} action={filters.active ? <Button onClick={filters.clear}>Limpar filtros</Button> : importButton} />
        : prefs.list ? <div className="relative overflow-x-auto rounded-ctl border border-line"><table className="w-full text-left text-xs"><thead className="text-dim"><tr>{['Selecionar', 'Vídeo', 'Origem', 'Estado', 'Publicado em', 'Importado', 'Tamanho', 'Ações'].map(h => <th key={h} className="p-3 font-normal">{h}</th>)}</tr></thead><tbody>{grid.items.map(i => <tr key={i.id} className="border-t border-line"><td className="p-3"><input type="checkbox" aria-label={`Selecionar ${i.caption}`} checked={selection.mode === 'all' || selection.ids.has(i.id)} onChange={() => setSelection(toggleId(selection, i.id))} /></td><td className="p-3"><button className="flex max-w-60 items-center gap-2 text-left" onClick={() => setPreview(i)}>{i.thumbnailPath && <img src={mediaUrl((!prefs.showBanner && i.firstFramePath) || i.thumbnailPath)} alt="" loading="lazy" className="h-10 w-8 rounded object-cover" />}<span className="truncate">{i.caption}<span className="block text-dim">{formatDuration(i.durationMs)}</span></span></button></td><td className="p-3">{i.sourceProfile ? `${i.sourcePlatform === 'tiktok' ? 'TikTok' : 'Instagram'} · @${i.sourceProfile}` : 'Computador'}</td><td className="p-3">{MEDIA_STATE_LABELS[i.status ?? 'ready']}</td><td className="p-3">{i.publishedAccounts?.length ?? 0} conta(s)</td><td className="p-3 whitespace-nowrap">{i.importedAt ? new Date(i.importedAt).toLocaleDateString('pt-BR') : '—'}</td><td className="p-3">{i.sizeBytes === undefined ? '—' : `${(i.sizeBytes / 1024 ** 2).toFixed(1)} MB`}</td><td className="p-3"><Button size="sm" aria-label="Excluir" onClick={() => setToDelete(i)}><Trash2 size={12} /></Button></td></tr>)}</tbody></table></div> : <MediaGrid showBanner={prefs.showBanner} items={grid.items} loading={grid.isLoading} selection={selection} onToggleSelect={(id) => setSelection(previous => toggleId(previous, id))}
            onOpen={setPreview}
            renderActions={(i) => (
              <>
                <MediaActions item={i} onPreview={() => setPreview(i)} onCompose={() => { setComposeSelection([i.id]); navigate('compose') }} onSchedule={() => setScheduleItem(i)} onSave={() => saveCopy.mutate(i.id)} onDelete={() => setToDelete(i)} />
                <Button size="sm" variant="secondary" aria-label={i.badges.includes('favorito') ? 'Remover dos favoritos' : 'Favoritar'} onClick={() => fav.mutate(i)}><Star size={12} /></Button>
                <Button size="sm" variant="secondary" aria-label="Excluir" onClick={() => setToDelete(i)}><Trash2 size={12} /></Button>
              </>
            )} />}
      <Pagination className="rounded-card border border-line bg-panel" label="Paginação da biblioteca" page={pageNo} pageSize={pageSize} total={grid.total} busy={page.isFetching} noun="vídeos" pageSizes={[30, 60, 120]} onPageSize={setPageSize} onPage={setPageNo} />
     </div>
      {preview && <MediaPreview key={preview.id} item={preview} onClose={() => setPreview(null)} />}
      {draftRequest && <ContainerDraftSheet key={draftRequest.key} workspaceId={workspace.id} timeZone={workspace.timeZone} request={draftRequest} onClose={() => setDraftRequest(null)} />}
      <Modal open={deleteIds !== null} onOpenChange={o => !o && !bulkDelete.isPending && setDeleteIds(null)} title={`Excluir ${deleteIds?.length ?? 0} vídeos?`} description="Remove as cópias da Biblioteca. Originais importados e histórico de publicação permanecem. Arquivos relacionados a tarefas ativas ou agendadas serão preservados."
        footer={<><Button disabled={bulkDelete.isPending} onClick={() => setDeleteIds(null)}>Cancelar</Button><Button variant="danger" disabled={bulkDelete.isPending} onClick={() => bulkDelete.mutate()}>Confirmar exclusão</Button></>} />
      {repost.modal}
      <Modal open={scheduleItem !== null} onOpenChange={o => !o && setScheduleItem(null)} title="Agendar no Instagram" description={account.data ? `Destino: @${account.data.username}. Horário em ${workspace.timeZone}.` : 'Conecte uma conta profissional em Contas.'} footer={<><Button onClick={() => setScheduleItem(null)}>Cancelar</Button><Button variant="primary" disabledReason={!account.data ? 'Conecte uma conta.' : deliveryError(scheduleAt,workspace.timeZone) ? deliveryError(scheduleAt,workspace.timeZone) : schedule.isPending ? 'Salvando…' : undefined} onClick={() => void repost.review({ postIds: [scheduleItem!.postId!] }, allow => schedule.mutate(allow))}>Confirmar agendamento</Button></>}><DeliveryTime value={scheduleAt} onChange={setScheduleAt} timeZone={workspace.timeZone} /><p className="mt-2 text-xs text-dim">O arquivo permanece na Biblioteca. O Instagram publica a cópia local; mantenha a conta conectada e o Legacy aberto.</p></Modal>
      <ImportResultsModal results={results} onClose={() => setResults(null)} />
      <Modal open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title="Excluir vídeo?"
        description="O vídeo, a capa e as versões editadas serão apagados deste computador. O arquivo original que você importou continua na pasta de origem."
        footer={<><Button onClick={() => setToDelete(null)}>Cancelar</Button><Button variant="danger" onClick={() => toDelete && del.mutate(toDelete.id)}>Excluir</Button></>} />
    </div>
  )
}

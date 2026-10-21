import { useRepostConfirmation } from '../compose/useRepostConfirmation'
import { CollapsibleCard } from '../../components/ui'
import { takeLibraryFocus } from '../../lib/selection'
import { MEDIA_STATE_LABELS } from '@shared/types'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Star, Trash2, Library, Grid2X2, List, MoreHorizontal, X, FolderOpen } from 'lucide-react'
import type { ImportResultDto } from '@shared/ipc-contract'
import type { GridItem, GridQuery } from '@shared/types'
import { call, pathForFile, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import { Button, EmptyState, DatePicker, Input, Modal, useToast, cx, FilterBar, FilterSearch, FacetFilter, Pagination, FilterPopover, FilterSection, FilterPresets, ActiveFilters, ChipGroup, Segmented, SortMenu, SelectionBar, type ActiveFilter, type FacetOption } from '../../components/ui'
import { localDate } from '@shared/agenda'
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

type Sort = 'importedAt' | 'durationMs' | 'views' | 'likes' | 'comments'
const STATUS_OPTIONS: FacetOption[] = [{ value: 'ready', label: 'Prontos', tone: 'green' }, { value: 'processing', label: 'Processando', tone: 'orange' }, { value: 'published', label: 'Publicados', tone: 'blue' }, { value: 'unpublished', label: 'Não publicados', tone: 'neutral' }, { value: 'scheduled', label: 'Agendados', tone: 'purple' }, { value: 'failed', label: 'Com erro', tone: 'red' }]

export function LibraryPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [preview, setPreview] = useState<GridItem | null>(null)
  const qc = useQueryClient()
  const [sortBy, setSortBy] = useState<Sort>('importedAt')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
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
  const [text, setText] = useState('')
  const [status, setStatus] = useState<GridQuery['status']>()
  const [sourceProfile, setSourceProfile] = useState('')
  const [publicationAccount, setPublicationAccount] = useState('')
  const [focusedAsset, setFocusedAsset] = useState(() => takeLibraryFocus(workspace.id))
  const [platform, setPlatform] = useState<GridQuery['platform']>()
  const [from, setFrom] = useState('')
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [scheduleItem, setScheduleItem] = useState<GridItem | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [toDelete, setToDelete] = useState<GridItem | null>(null)
  const q = { assetId: focusedAsset?.assetId, publicationJobId: focusedAsset?.publicationJobId, workspaceId: workspace.id, source: 'library' as const, sortBy, sortDir: 'desc' as const, favoritesOnly: favoritesOnly || undefined, text: text || undefined, status, sourceProfile: sourceProfile || undefined, publicationAccount: publicationAccount || undefined, platform, from: from ? zonedToUtc(from, '00:00', workspace.timeZone).toISOString() : undefined }
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
  const grid = { items: page.data?.items ?? [], total: page.data?.total ?? 0, loadedNote: page.data?.loadedNote ?? '', isError: page.isError, error: page.error, isLoading: page.isLoading }
  const pending = useQuery({ queryKey: ['library-pending', workspace.id], queryFn: () => call('library.pending', { workspaceId: workspace.id }), refetchInterval: 2000 })
  const account = useQuery({ queryKey: ['instagram-account', workspace.id], queryFn: () => call('accounts.instagram', { workspaceId: workspace.id }) })
  const repost = useRepostConfirmation(workspace.id, account.data?.id)
  const schedule = useMutation({ mutationFn: (allowRepost: boolean = false) => { const [date, time] = scheduleAt.split('T'); return call('profiles.scheduleInstagram', { workspaceId: workspace.id, postIds: [scheduleItem!.postId!], firstAt: zonedToUtc(date, time, workspace.timeZone).toISOString(), intervalMin: 60, allowRepost, cleanupAfterPublish: false, shareToFeed: true }) }, onSuccess: () => { setScheduleItem(null); void qc.invalidateQueries(); navigate('queue') }, onError: e => toast.show({ title: 'Não foi possível agendar', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const saveCopy = useMutation({ mutationFn: (id: string) => call('library.saveCopy', { workspaceId: workspace.id, id }), onSuccess: result => result.saved && toast.show({ title: 'Cópia salva' }), onError: e => toast.show({ title: 'Não foi possível salvar', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  const bulkDelete = useMutation({ mutationFn: () => call('library.deleteMany', { workspaceId: workspace.id, ids: deleteIds! }), onSuccess: result => {
    setDeleteIds(null); setSelection(emptySelection()); void qc.invalidateQueries()
    toast.show({ title: `${result.deleted.length} vídeo(s) excluído(s)`, body: `${result.blocked.length} em uso preservados; ${result.failed.length} falhas.`, tone: result.failed.length ? 'error' : 'info' })
  }, onError: e => toast.show({ title: 'Não foi possível excluir', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
  useEffect(() => { setOffset(0); setSelection(emptySelection()) }, [sortBy, favoritesOnly, text, status, sourceProfile, publicationAccount, platform, from])
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
  const libraryFilters: ActiveFilter[] = [
    ...(text ? [{ key: 'text', label: 'Busca: ' + text, clear: () => setText('') }] : []),
    ...(status ? [{ key: 'status', label: 'Estado: ' + MEDIA_STATE_LABELS[status], clear: () => setStatus(undefined) }] : []),
    ...(sourceProfile ? [{ key: 'source', label: 'Origem: ' + sourceProfile, clear: () => setSourceProfile('') }] : []),
    ...(publicationAccount ? [{ key: 'account', label: 'Publicado por: ' + publicationAccount, clear: () => setPublicationAccount('') }] : []),
    ...(platform ? [{ key: 'platform', label: platform === 'instagram' ? 'Instagram' : 'TikTok', clear: () => setPlatform(undefined) }] : []),
    ...(from ? [{ key: 'from', label: 'Importado desde: ' + from.split('-').reverse().join('/'), clear: () => setFrom('') }] : []),
    ...(favoritesOnly ? [{ key: 'fav', label: 'Somente favoritos', clear: () => setFavoritesOnly(false) }] : [])
  ]
  const daysAgo = (n: number) => localDate(Date.now() - (n - 1) * 86_400_000, workspace.timeZone)
  const IMPORT_RANGES = [{ value: 'any', label: 'Qualquer data', from: () => '' }, { value: 'today', label: 'Hoje', from: () => daysAgo(1) }, { value: '7', label: '7 dias', from: () => daysAgo(7) }, { value: '30', label: '30 dias', from: () => daysAgo(30) }]
  const clearFilters = () => { setText(''); setStatus(undefined); setSourceProfile(''); setPublicationAccount(''); setPlatform(undefined); setFrom(''); setFavoritesOnly(false) }
  const importButton = <Button data-tour="library-import" variant="primary" icon={<Upload size={14} />} disabled={pick.isPending || byPaths.isPending} onClick={() => pick.mutate()}>Importar vídeos</Button>

  return (
    <div data-testid="drop-zone" className={cx('flex min-h-full w-full min-w-0 flex-col gap-4 p-6', dragging && 'outline-2 outline-dashed outline-dim -outline-offset-8')}
      onDragOver={(e) => { if (!Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {focusedAsset && <div role="status" className="ds-summary flex items-center justify-between gap-3"><span>Mostrando somente o vídeo desta publicação.</span><Button size="sm" onClick={() => setFocusedAsset(undefined)}>Limpar filtro do vídeo</Button></div>}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Biblioteca</h1>
          <p className="text-xs text-dim">{grid.loadedNote || 'Seus vídeos ficam guardados neste computador.'} Arraste arquivos para cá ou use o botão.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Button icon={<FolderOpen size={14} />} onClick={() => setDraftRequest({ mode: 'manage', videos: [], key: crypto.randomUUID() })}>Containers em rascunho</Button>{importButton}</div>
      </header>
      <section aria-label="Filtros da biblioteca" className="ds-filter-card">
        <FilterBar label="Filtrar biblioteca" actions={<>
          <SortMenu<Sort> value={sortBy} onChange={setSortBy} options={[{ value: 'importedAt', label: 'Mais recentes' }, { value: 'durationMs', label: 'Mais longos' }, { value: 'views', label: 'Mais vistos' }, { value: 'likes', label: 'Mais curtidos' }, { value: 'comments', label: 'Mais comentados' }]} />
          <Segmented<'grid' | 'list'> label="Visualização" value={prefs.list ? 'list' : 'grid'} onChange={v => prefs.save.mutate({ key: 'mediaViewList', value: v === 'list' })} options={[{ value: 'grid', label: '', icon: <Grid2X2 size={14} aria-hidden />, ariaLabel: 'Visualização em grade' }, { value: 'list', label: '', icon: <List size={14} aria-hidden />, ariaLabel: 'Visualização em lista' }]} />
        </>}>
          <FilterSearch label="Buscar mídia" placeholder="Nome, perfil, legenda ou origem" value={text} onChange={setText} />
          <FacetFilter label="Estado" value={status ? [status] : []} onChange={v => setStatus((v[0] || undefined) as GridQuery['status'])} options={STATUS_OPTIONS} />
          <FacetFilter label="Plataforma" value={platform ? [platform] : []} onChange={v => setPlatform((v[0] || undefined) as GridQuery['platform'])} options={[{ value: 'instagram', label: 'Instagram' }, { value: 'tiktok', label: 'TikTok' }]} />
          <FilterPopover count={[sourceProfile, publicationAccount, from].filter(Boolean).length} total={grid.total} onReset={() => { setSourceProfile(''); setPublicationAccount(''); setFrom('') }}>
            <FilterSection title="Origem e publicação">
              <Input label="Perfil de origem" placeholder="@perfil" value={sourceProfile} onChange={e => setSourceProfile(e.target.value)} className="w-full" />
              <Input label="Conta que publicou" placeholder="@conta" value={publicationAccount} onChange={e => setPublicationAccount(e.target.value)} className="w-full" />
            </FilterSection>
            <FilterSection title="Importação">
              <ChipGroup label="Período de importação" value={IMPORT_RANGES.find(r => r.from() === from)?.value ?? (from ? 'custom' : 'any')} onChange={v => { const r = IMPORT_RANGES.find(x => x.value === v); if (r) setFrom(r.from()) }} options={[...IMPORT_RANGES.map(r => ({ value: r.value, label: r.label })), ...(from && !IMPORT_RANGES.some(r => r.from() === from) ? [{ value: 'custom', label: 'Personalizado' }] : [])]} />
              <DatePicker label="Importado a partir de" value={from} onChange={setFrom} clearable />
            </FilterSection>
            <FilterSection title="Exibição">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.showBanner} onChange={e => prefs.save.mutate({ key: 'mediaShowBanner', value: e.target.checked })} />Exibir banner nas miniaturas</label>
            </FilterSection>
          </FilterPopover>
        </FilterBar>
        <div className="flex flex-wrap items-center gap-3">
          <FilterPresets presets={[
            { id: 'fav', label: 'Favoritos', icon: <Star size={11} aria-hidden />, active: favoritesOnly && !status, apply: () => { const next = !favoritesOnly; clearFilters(); setFavoritesOnly(next) } },
            { id: 'ready', label: 'Prontos e não publicados', active: status === 'unpublished' && !favoritesOnly, apply: () => { clearFilters(); setStatus('unpublished') } },
            { id: 'week', label: 'Importados nos últimos 7 dias', active: from === daysAgo(7) && !status, apply: () => { clearFilters(); setFrom(daysAgo(7)) } },
            { id: 'scheduled', label: 'Agendados', active: status === 'scheduled', apply: () => { clearFilters(); setStatus('scheduled') } },
            { id: 'failed', label: 'Com erro', active: status === 'failed', apply: () => { clearFilters(); setStatus('failed') } }
          ]} />
        </div>
        <ActiveFilters filters={libraryFilters} total={grid.total} noun="vídeos" onClear={clearFilters} />
      </section>
      {/* Actions on the selection appear only when something is selected, instead of a row of disabled buttons. */}
      <div data-tour="library-selection"><SelectionBar count={selectionCount(selection)} label={selectionLabel(selection)} onClear={() => setSelection(emptySelection())}
        hint="Selecione vídeos (ou Ctrl + clique nos cards) para criar um Container, adicionar a um rascunho ou preparar um lote."
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
      {(pick.isPending || byPaths.isPending) && <p role="status" className="rounded-ctl border border-line p-3 text-xs">Importando e verificando arquivos…</p>}
      {!!pending.data?.length && <CollapsibleCard defaultOpen title={<>Fila de mídia · {pending.data.length} tarefa(s) recentes</>}><ul className="max-h-44 overflow-y-auto divide-y divide-line">{pending.data.map(job => <li key={job.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span>{job.label}</span><span className={job.state === 'failed' ? 'text-danger-fg' : 'text-dim'}>{job.state === 'running' ? 'Processando…' : job.state === 'queued' ? 'Aguardando' : 'Falhou'}</span>{job.error && <p className="w-full text-danger-fg">{job.error}</p>}</li>)}</ul></CollapsibleCard>}
      {pending.isError && <p role="alert" className="text-xs text-danger-fg">Fila de mídia indisponível. <button onClick={() => void pending.refetch()}>Tentar novamente</button></p>}
      {grid.isError && <p className="text-sm text-danger-fg">Não foi possível carregar a biblioteca. {grid.error instanceof ApiError ? grid.error.message : ''}</p>}
      {!grid.isLoading && grid.items.length === 0 && !grid.isError
        ? <EmptyState icon={<Library size={28} />} title={text || status || sourceProfile || publicationAccount || platform || from || favoritesOnly ? 'Nenhuma mídia encontrada' : 'Comece pela biblioteca'} body={text || status || sourceProfile || publicationAccount || platform || from || favoritesOnly ? 'Ajuste os filtros para encontrar outros conteúdos.' : 'Importe vídeos do seu computador. Eles ficam guardados aqui, e o original nunca é alterado.'} action={importButton} />
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

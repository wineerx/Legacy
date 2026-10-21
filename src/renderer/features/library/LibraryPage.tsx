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
import { Button, EmptyState, Select, DatePicker, Input, Modal, Pills, useToast, cx } from '../../components/ui'
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
  const [offset, setOffset] = useState(0)
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
  const page = useQuery({ queryKey: ['grid', q, offset], queryFn: () => call('grid.query', { ...q, limit: 60, offset }), refetchInterval: 3000 })
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
  useEffect(() => { if (page.data && offset > 0 && offset >= page.data.total) setOffset(0) }, [page.data?.total, offset])
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
  const libraryFilters = [
    ...(text ? [{ label: 'Busca: ' + text, clear: () => setText('') }] : []),
    ...(status ? [{ label: 'Estado: ' + MEDIA_STATE_LABELS[status], clear: () => setStatus(undefined) }] : []),
    ...(sourceProfile ? [{ label: 'Origem: ' + sourceProfile, clear: () => setSourceProfile('') }] : []),
    ...(publicationAccount ? [{ label: 'Publicado por: ' + publicationAccount, clear: () => setPublicationAccount('') }] : []),
    ...(platform ? [{ label: platform === 'instagram' ? 'Instagram' : 'TikTok', clear: () => setPlatform(undefined) }] : []),
    ...(from ? [{ label: 'Importado desde: ' + from.split('-').reverse().join('/'), clear: () => setFrom('') }] : []),
    ...(favoritesOnly ? [{ label: 'Favoritos', clear: () => setFavoritesOnly(false) }] : [])
  ]
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
      <section aria-label="Filtros da biblioteca" className="filters-panel shrink-0 overflow-hidden rounded-card border border-line bg-panel">
        <div className="grid grid-cols-1 items-end gap-4 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_auto]">
          <Input label="Buscar mídia" placeholder="Nome, perfil, legenda ou origem" value={text} onChange={e => setText(e.target.value)} className="w-full" />
          <Select label="Estado" aria-label="Estado da mídia" value={status ?? ''} onChange={e => setStatus((e.target.value || undefined) as GridQuery['status'])}><option value="">Todos</option><option value="ready">Prontos</option><option value="processing">Processando</option><option value="published">Publicados</option><option value="unpublished">Não publicados</option><option value="scheduled">Agendados</option><option value="failed">Com erro</option></Select>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1"><Button aria-label="Visualização em grade" aria-pressed={!prefs.list} onClick={() => prefs.save.mutate({ key: 'mediaViewList', value: false })}><Grid2X2 size={14} /></Button><Button aria-label="Visualização em lista" aria-pressed={prefs.list} onClick={() => prefs.save.mutate({ key: 'mediaViewList', value: true })}><List size={14} /></Button></div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.showBanner} onChange={e => prefs.save.mutate({ key: 'mediaShowBanner', value: e.target.checked })} />Exibir banner</label>
          </div>
        </div>
        <CollapsibleCard className="border-x-0 border-b-0 rounded-none" title="Filtros de origem e publicação" description="Encontre mídia pela origem, conta de publicação e data de importação.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Input label="Perfil de origem" placeholder="@perfil" value={sourceProfile} onChange={e => setSourceProfile(e.target.value)} className="w-full" />
            <Input label="Conta que publicou" placeholder="@conta" value={publicationAccount} onChange={e => setPublicationAccount(e.target.value)} className="w-full" />
            <DatePicker label="Importado a partir de" value={from} onChange={setFrom} clearable />
            <Select label="Plataforma" value={platform ?? ''} onChange={e => setPlatform((e.target.value || undefined) as GridQuery['platform'])}><option value="">Todas</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></Select>
          </div>
        </CollapsibleCard>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-xs" aria-live="polite">
          <span className="text-dim">{grid.total} resultado(s)</span>
          {libraryFilters.length ? <>
            {libraryFilters.map(filter => <button type="button" key={filter.label} aria-label={'Remover filtro: ' + filter.label} onClick={filter.clear}
              className="flex max-w-full items-center gap-1 rounded-ctl border border-line bg-raised px-2 py-1"><span className="truncate">{filter.label}</span><X size={12} className="shrink-0" aria-hidden /></button>)}
            <Button size="sm" variant="ghost" onClick={clearFilters}>Limpar filtros</Button>
          </> : <span className="text-dim">Sem filtros aplicados</span>}
        </div>
      </section>
      <div data-tour="library-selection" className="flex flex-wrap items-center gap-2">
        <Pills<Sort> label="Ordenar" value={sortBy} onChange={setSortBy} options={[{ value: 'importedAt', label: 'Mais recentes' }, { value: 'durationMs', label: 'Mais longos' }, { value: 'views', label: 'Views' }, { value: 'likes', label: 'Curtidas' }, { value: 'comments', label: 'Comentários' }]} />
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <Pills label="Filtro" value={favoritesOnly ? 'fav' : 'all'} onChange={(v) => setFavoritesOnly(v === 'fav')} options={[{ value: 'all', label: 'Todos' }, { value: 'fav', label: 'Favoritos' }]} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSelection(selectPage(selection, grid.items.map((i) => i.id)))}>Selecionar página</Button>
          <Input aria-label="Quantidade Top N" type="number" min={1} max={1000} value={topN} onChange={e => setTopN(e.target.value)} className="w-20" />
          <Button size="sm" disabled={selectTop.isPending || openContainer.isPending || grid.isLoading} onClick={() => selectTop.mutate()}>Selecionar Top N</Button>
        </div>
      </div>
      {/* Actions on the selection appear only when something is selected, instead of a row of disabled buttons. */}
      {selectionCount(selection) > 0 ? <div role="toolbar" aria-label="Ações da seleção" className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-card border border-line-strong bg-raised px-3 py-2 shadow-lg">
        <span className="text-sm font-semibold" aria-live="polite">{selectionLabel(selection)}</span>
        <Button size="sm" variant="ghost" onClick={() => setSelection(emptySelection())}>Limpar</Button>
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="primary" disabled={openContainer.isPending || selectTop.isPending} disabledReason={selectionCount(selection) > 1000 ? 'Use até 1.000 vídeos por Container.' : undefined} onClick={() => openContainer.mutate('new')}>Criar novo Container</Button>
        <Button size="sm" disabled={openContainer.isPending || selectTop.isPending} disabledReason={selectionCount(selection) > 1000 ? 'Use até 1.000 vídeos por Container.' : undefined} onClick={() => openContainer.mutate('append')}>Adicionar ao Container</Button>
        <Button size="sm" disabledReason={selectionCount(selection) > 100 ? 'Prepare até 100 vídeos por lote.' : undefined} onClick={prepare}>Preparar lote</Button>
        <Button size="sm" variant="danger" className="ml-auto" disabledReason={selectionCount(selection) > 200 ? 'Exclua até 200 arquivos por vez.' : undefined} onClick={() => selection.mode === 'ids' && setDeleteIds([...selection.ids])}><Trash2 size={12} />Excluir selecionados</Button>
      </div> : <p className="text-xs text-dim">Selecione vídeos (ou Ctrl + clique nos cards) para criar um Container, adicionar a um rascunho ou preparar um lote.</p>}
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
      {grid.total > 60 && <div className="flex items-center justify-end gap-3 text-xs"><span>{offset + 1}–{Math.min(offset + 60, grid.total)} de {grid.total}</span><Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 60))}>Anterior</Button><Button size="sm" disabled={offset + 60 >= grid.total} onClick={() => setOffset(offset + 60)}>Próxima página</Button></div>}
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

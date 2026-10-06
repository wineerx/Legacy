import { useRepostConfirmation } from '../compose/useRepostConfirmation'
import { CollapsibleCard } from '../../components/ui'
import { takeLibraryFocus } from '../../lib/selection'
import { MEDIA_STATE_LABELS } from '@shared/types'
import { useEffect, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Star, Trash2, Library, Grid2X2, List, MoreHorizontal } from 'lucide-react'
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

type Sort = 'importedAt' | 'durationMs' | 'views' | 'likes' | 'comments'

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
  const page = useQuery({ queryKey: ['grid', q, offset], queryFn: () => call('grid.query', { ...q, limit: 60, offset }), refetchInterval: 3000 })
  const grid = { items: page.data?.items ?? [], total: page.data?.total ?? 0, loadedNote: page.data?.loadedNote ?? '', isError: page.isError, error: page.error, isLoading: page.isLoading }
  const pending = useQuery({ queryKey: ['library-pending', workspace.id], queryFn: () => call('library.pending', { workspaceId: workspace.id }), refetchInterval: 2000 })
  const account = useQuery({ queryKey: ['instagram-account', workspace.id], queryFn: () => call('accounts.instagram', { workspaceId: workspace.id }) })
  const repost = useRepostConfirmation(workspace.id, account.data?.id)
  const schedule = useMutation({ mutationFn: (allowRepost: boolean = false) => { const [date, time] = scheduleAt.split('T'); return call('profiles.scheduleInstagram', { workspaceId: workspace.id, postIds: [scheduleItem!.postId!], firstAt: zonedToUtc(date, time, workspace.timeZone).toISOString(), intervalMin: 60, allowRepost, cleanupAfterPublish: false }) }, onSuccess: () => { setScheduleItem(null); void qc.invalidateQueries(); navigate('queue') }, onError: e => toast.show({ title: 'Não foi possível agendar', body: e instanceof Error ? e.message : undefined, tone: 'error' }) })
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
  const importButton = <Button data-tour="library-import" variant="primary" icon={<Upload size={14} />} disabled={pick.isPending || byPaths.isPending} onClick={() => pick.mutate()}>Importar vídeos</Button>

  return (
    <div data-testid="drop-zone" className={cx('flex min-h-full w-full min-w-0 flex-col gap-4 p-6', dragging && 'outline-2 outline-dashed outline-dim -outline-offset-8')}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      {focusedAsset && <div role="status" className="ds-summary flex items-center justify-between gap-3"><span>Mostrando somente o vídeo desta publicação.</span><Button size="sm" onClick={() => setFocusedAsset(undefined)}>Limpar filtro do vídeo</Button></div>}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Biblioteca</h1>
          <p className="text-xs text-dim">{grid.loadedNote || 'Seus vídeos ficam guardados neste computador.'} Arraste arquivos para cá ou use o botão.</p>
        </div>
        {importButton}
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Input label="Buscar mídia" placeholder="Nome, perfil, legenda ou origem" value={text} onChange={e => setText(e.target.value)} />
        <Select label="Estado" aria-label="Estado da mídia" value={status ?? ''} onChange={e => setStatus((e.target.value || undefined) as GridQuery['status'])}><option value="">Todos</option><option value="ready">Prontos</option><option value="processing">Processando</option><option value="published">Publicados</option><option value="unpublished">Não publicados</option><option value="scheduled">Agendados</option><option value="failed">Com erro</option></Select>
        <div className="ml-auto flex gap-1"><Button aria-label="Visualização em grade" aria-pressed={!prefs.list} onClick={() => prefs.save.mutate({ key: 'mediaViewList', value: false })}><Grid2X2 size={14} /></Button><Button aria-label="Visualização em lista" aria-pressed={prefs.list} onClick={() => prefs.save.mutate({ key: 'mediaViewList', value: true })}><List size={14} /></Button></div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.showBanner} onChange={e => prefs.save.mutate({ key: 'mediaShowBanner', value: e.target.checked })} />Exibir banner</label>
      </div>
      <CollapsibleCard title={<>Filtros de origem e publicação</>}><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Input label="Perfil de origem" value={sourceProfile} onChange={e => setSourceProfile(e.target.value)} /><Input label="Conta que publicou" value={publicationAccount} onChange={e => setPublicationAccount(e.target.value)} /><DatePicker label="Importado a partir de" value={from} onChange={setFrom} clearable /><Select label="Plataforma" value={platform ?? ''} onChange={e => setPlatform((e.target.value || undefined) as GridQuery['platform'])}><option value="">Todas</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></Select></div></CollapsibleCard>
      <div data-tour="library-selection" className="flex flex-wrap items-center gap-2">
        <Pills<Sort> label="Ordenar" value={sortBy} onChange={setSortBy} options={[{ value: 'importedAt', label: 'Mais recentes' }, { value: 'durationMs', label: 'Mais longos' }, { value: 'views', label: 'Views' }, { value: 'likes', label: 'Curtidas' }, { value: 'comments', label: 'Comentários' }]} />
        <Pills label="Filtro" value={favoritesOnly ? 'fav' : 'all'} onChange={(v) => setFavoritesOnly(v === 'fav')} options={[{ value: 'all', label: 'Todos' }, { value: 'fav', label: 'Favoritos' }]} />
        <span className="ml-auto text-xs text-dim">{selectionLabel(selection)}</span>
        <Button size="sm" variant="ghost" onClick={() => setSelection(selectPage(selection, grid.items.map((i) => i.id)))}>Selecionar página</Button>
        
        {selectionCount(selection) > 0 && <Button size="sm" variant="ghost" onClick={() => setSelection(emptySelection())}>Limpar</Button>}
        {selectionCount(selection) > 0 && <Button size="sm" variant="danger" disabledReason={selectionCount(selection) > 200 ? 'Exclua até 200 arquivos por vez.' : undefined} onClick={() => selection.mode === 'ids' && setDeleteIds([...selection.ids])}><Trash2 size={12} />Excluir selecionados</Button>}
        <Button size="sm" variant="primary" disabledReason={selectionCount(selection) === 0 ? 'Selecione ao menos um vídeo.' : selectionCount(selection) > 100 ? 'Prepare até 100 vídeos por lote.' : undefined} onClick={prepare}>Preparar lote</Button>
      </div>
      {(pick.isPending || byPaths.isPending) && <p role="status" className="rounded-ctl border border-line p-3 text-xs">Importando e verificando arquivos…</p>}
      {!!pending.data?.length && <CollapsibleCard defaultOpen title={<>Fila de mídia · {pending.data.length} tarefa(s) recentes</>}><ul className="max-h-44 overflow-y-auto divide-y divide-line">{pending.data.map(job => <li key={job.id} className="flex flex-wrap justify-between gap-2 py-2 text-xs"><span>{job.label}</span><span className={job.state === 'failed' ? 'text-danger-fg' : 'text-dim'}>{job.state === 'running' ? 'Processando…' : job.state === 'queued' ? 'Aguardando' : 'Falhou'}</span>{job.error && <p className="w-full text-danger-fg">{job.error}</p>}</li>)}</ul></CollapsibleCard>}
      {pending.isError && <p role="alert" className="text-xs text-danger-fg">Fila de mídia indisponível. <button onClick={() => void pending.refetch()}>Tentar novamente</button></p>}
      {grid.isError && <p className="text-sm text-danger-fg">Não foi possível carregar a biblioteca. {grid.error instanceof ApiError ? grid.error.message : ''}</p>}
      {!grid.isLoading && grid.items.length === 0 && !grid.isError
        ? <EmptyState icon={<Library size={28} />} title={text || status || sourceProfile || publicationAccount || platform || from || favoritesOnly ? 'Nenhuma mídia encontrada' : 'Comece pela biblioteca'} body={text || status || sourceProfile || publicationAccount || platform || from || favoritesOnly ? 'Ajuste os filtros para encontrar outros conteúdos.' : 'Importe vídeos do seu computador. Eles ficam guardados aqui, e o original nunca é alterado.'} action={importButton} />
        : prefs.list ? <div className="relative overflow-x-auto rounded-ctl border border-line"><table className="w-full text-left text-xs"><thead className="text-dim"><tr>{['Selecionar', 'Vídeo', 'Origem', 'Estado', 'Publicado em', 'Importado', 'Tamanho', 'Ações'].map(h => <th key={h} className="p-3 font-normal">{h}</th>)}</tr></thead><tbody>{grid.items.map(i => <tr key={i.id} className="border-t border-line"><td className="p-3"><input type="checkbox" aria-label={`Selecionar ${i.caption}`} checked={selection.mode === 'all' || selection.ids.has(i.id)} onChange={() => setSelection(toggleId(selection, i.id))} /></td><td className="p-3"><button className="flex max-w-60 items-center gap-2 text-left" onClick={() => setPreview(i)}>{i.thumbnailPath && <img src={mediaUrl((!prefs.showBanner && i.firstFramePath) || i.thumbnailPath)} alt="" loading="lazy" className="h-10 w-8 rounded object-cover" />}<span className="truncate">{i.caption}<span className="block text-dim">{formatDuration(i.durationMs)}</span></span></button></td><td className="p-3">{i.sourceProfile ? `${i.sourcePlatform === 'tiktok' ? 'TikTok' : 'Instagram'} · @${i.sourceProfile}` : 'Computador'}</td><td className="p-3">{MEDIA_STATE_LABELS[i.status ?? 'ready']}</td><td className="p-3">{i.publishedAccounts?.length ?? 0} conta(s)</td><td className="p-3 whitespace-nowrap">{i.importedAt ? new Date(i.importedAt).toLocaleDateString('pt-BR') : '—'}</td><td className="p-3">{i.sizeBytes === undefined ? '—' : `${(i.sizeBytes / 1024 ** 2).toFixed(1)} MB`}</td><td className="p-3"><Button size="sm" aria-label="Excluir" onClick={() => setToDelete(i)}><Trash2 size={12} /></Button></td></tr>)}</tbody></table></div> : <MediaGrid showBanner={prefs.showBanner} items={grid.items} loading={grid.isLoading} selection={selection} onToggleSelect={(id) => setSelection(toggleId(selection, id))}
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

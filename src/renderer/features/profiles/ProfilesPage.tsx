import { ProfileListItem } from './ProfileListItem'
import { ProfileSidebar } from './ProfileSidebar'
import { ContentSourcePicker } from './ContentSourcePicker'
import { useRepostConfirmation } from '../compose/useRepostConfirmation'
import { CollapsibleCard } from '../../components/ui'
import { ProfileAvatar } from '../../components/ui/ProfileAvatar'
import * as Popover from '@radix-ui/react-popover'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RefreshCw,
  Link2,
  FileUp,
  ArrowDownUp,
  UserSearch,
  Download,
  ListOrdered,
  Archive,
  Pause,
  X
} from 'lucide-react'
import type { SortDir, GridItem } from '@shared/types'
import { call, ApiError } from '../../lib/api'
import { useWorkspace } from '../../lib/workspace'
import {
  Button,
  EmptyState,
  Spinner,
  Input,
  Modal,
  useToast,
  FilterBar,
  FilterSearch,
  FacetFilter,
  FilterPopover,
  FilterSection,
  FilterPresets,
  ActiveFilters,
  ChipGroup,
  Segmented,
  Pagination,
  SortMenu,
  SelectionBar,
  type ActiveFilter
} from '../../components/ui'
import { ActionIcon } from '../../components/ActionIcon'
import { MediaPreview } from '../../components/MediaPreview'
import { MediaGrid } from '../../components/MediaGrid'
import { useGridQuery } from './useGridQuery'
import {
  emptySelection,
  toggleId,
  selectPage,
  selectionLabel,
  selectionCount,
  setComposeSelection,
  type Selection
} from '../../lib/selection'
import type { PageProps } from '../../routes'
import { DeliveryTime, deliveryError } from '../../components/ui'
import { zonedToUtc } from '@shared/schedule'
import { useMascotSignal } from '../../components/brand/MascotProvider'

import type { ProfileContentSource } from '@shared/ipc-contract'

const sourceLabels = { posts: 'Posts', reels: 'Reels', tagged: 'Marcados', all: 'Todos' }
const formatProfileCount = (value: number | null | undefined) => typeof value === 'number' ? value.toLocaleString('pt-BR') : '—'
type Sort = 'views' | 'likes' | 'comments' | 'postedAt'

export function ProfilesPage({ navigate }: PageProps) {
  const { workspace } = useWorkspace()
  const toast = useToast()
  const [preview, setPreview] = useState<GridItem | null>(null)
  const qc = useQueryClient()
  const profiles = useQuery({
    queryKey: ['profiles', workspace.id],
    queryFn: () => call('profiles.list', { workspaceId: workspace.id })
  })
  const refresh = useMutation({
    mutationFn: async () => {
      const instagramProfiles = profiles.data?.filter((p) => p.platform === 'instagram') ?? []
      const failures: string[] = []
      for (const p of instagramProfiles) {
        try {
          await call('profiles.refresh', { workspaceId: workspace.id, profileId: p.id })
        } catch (e) {
          failures.push(`@${p.username}: ${e instanceof Error ? e.message : 'Falha na atualização'}`)
        }
      }
      return { updated: instagramProfiles.length - failures.length, failures }
    },
    onSuccess: ({ updated, failures }) => {
      toast.show({ title: failures.length ? `${updated} perfil(is) atualizado(s); ${failures.length} falha(s)` : 'Dados de todos os perfis atualizados', body: failures.length ? failures.join('\n') : undefined, tone: failures.length ? 'error' : undefined })
    },
    onError: (e) => toast.show({ title: 'Não foi possível atualizar os perfis', body: e instanceof Error ? e.message : undefined, tone: 'error' }),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['profiles', workspace.id] }) }
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const active =
    profiles.data?.find((p) => p.id === activeId) ?? profiles.data?.[0] ?? null
  const [archivedOpen, setArchivedOpen] = useState(false)
  const archivedProfiles = useQuery({
    queryKey: ['profiles-archived', workspace.id],
    queryFn: () => call('profiles.archived', { workspaceId: workspace.id })
  })
  const archive = useMutation({
    mutationFn: ({ profileId, archived }: { profileId: string; archived: boolean }) =>
      call('profiles.archive', { workspaceId: workspace.id, profileId, archived }),
    onSuccess: (_, input) => {
      if (input.archived && active?.id === input.profileId) {
        setActiveId(null)
        setSelection(emptySelection())
        setPreview(null)
        setProgressOpen(false)
      }
      if (!input.archived) setActiveId(input.profileId)
      void qc.invalidateQueries({ queryKey: ['profiles', workspace.id] })
      void qc.invalidateQueries({ queryKey: ['profiles-archived', workspace.id] })
      toast.show({ title: input.archived ? 'Perfil arquivado' : 'Perfil restaurado', body: input.archived ? 'Você pode restaurá-lo em Perfis arquivados.' : undefined })
    },
    onError: e => toast.show({ title: 'Não foi possível alterar o perfil', body: e instanceof Error ? e.message : undefined, tone: 'error' })
  })
  const profileRefresh = useMutation({
    mutationFn: (profileId: string) => call('profiles.refresh', { workspaceId: workspace.id, profileId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['profiles', workspace.id] }) },
    onError: e => toast.show({ title: 'Não foi possível carregar as métricas do perfil', body: e instanceof Error ? e.message : undefined, tone: 'error' })
  })
  const [progressOpen, setProgressOpen] = useState(false)
  const progress = useQuery({
    queryKey: ['profile-import-progress', workspace.id, active?.id],
    enabled: Boolean(active),
    queryFn: () =>
      call('profiles.importProgress', {
        workspaceId: workspace.id,
        profileId: active!.id
      }),
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.state ?? '')
        ? 2000
        : false
  })
  const importing = ['queued', 'running'].includes(progress.data?.state ?? '')
  const cancelImport = useMutation({
    mutationFn: (profileId: string) => call('profiles.cancelImport', { workspaceId: workspace.id, profileId }),
    onSuccess: (stopped) => {
      void qc.invalidateQueries({ queryKey: ['profile-import-progress', workspace.id] })
      void qc.invalidateQueries({ queryKey: ['grid'] })
      toast.show(stopped ? { title: 'Importação cancelada', body: 'Os posts já importados continuam na grade.' } : { title: 'A importação já tinha terminado' })
    },
    onError: e => toast.show({ title: 'Não foi possível cancelar a importação', body: e instanceof Error ? e.message : undefined, tone: 'error' })
  })
  useEffect(() => {
    if (progress.data?.progress?.processed) {
      void qc.invalidateQueries({ queryKey: ['grid'] })
      void qc.invalidateQueries({ queryKey: ['profiles'] })
    }
  }, [progress.data?.progress?.processed])
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string>()
  const [reelOpen, setReelOpen] = useState(false)
  const [reelUrl, setReelUrl] = useState('')
  const [reelError, setReelError] = useState<string>()
  const [sortBy, setSortBy] = useState<Sort>('views')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [text, setText] = useState('')
  const [hashtag, setHashtag] = useState('')
  const [minViews, setMinViews] = useState('')
  const [selection, setSelection] = useState<Selection>(emptySelection())
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadLimit, setDownloadLimit] = useState('20')
  const [topCount, setTopCount] = useState('5')
  const [discoveryLimit, setDiscoveryLimit] = useState('100')
  const [newSource, setNewSource] = useState<ProfileContentSource>('posts')
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, ProfileContentSource>>({})
  const activeSource = active?.platform === 'instagram' ? sourceOverrides[active.id] ?? active.contentSource ?? 'posts' : 'posts'
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [cleanupAfterPublish, setCleanupAfterPublish] = useState(false)
  const [shareToFeed, setShareToFeed] = useState(true)
  const [scheduleAt, setScheduleAt] = useState('')
  const [intervalMin, setIntervalMin] = useState('60')
  const [scheduleCaption, setScheduleCaption] = useState('')
  const [minLikes, setMinLikes] = useState('')
  const [minComments, setMinComments] = useState('')
  const [mediaKind, setMediaKind] = useState<'all' | 'videos' | 'images'>('all')
  const [topItems, setTopItems] = useState<GridItem[]>([])
  const [gridPage, setGridPage] = useState(1), [gridPageSize, setGridPageSize] = useState(60)
  const ids = selection.mode === 'ids' ? [...selection.ids] : []
  const account = useQuery({
    queryKey: ['instagram-account', workspace.id],
    queryFn: () => call('accounts.instagram', { workspaceId: workspace.id })
  })
  const repost = useRepostConfirmation(workspace.id, account.data?.id, navigate)
  const schedule = useMutation({
    mutationFn: (allowRepost: boolean = false) => {
      const [date, time] = scheduleAt.split('T')
      return call('profiles.scheduleInstagram', {
        workspaceId: workspace.id,
        postIds: ids,
        firstAt: zonedToUtc(date, time, workspace.timeZone).toISOString(),
        intervalMin: ids.length > 1 ? Number(intervalMin) : 60,
        caption: scheduleCaption || undefined,
        cleanupAfterPublish, shareToFeed, allowRepost
      })
    },
    onSuccess: () => {
      setScheduleOpen(false)
      void qc.invalidateQueries()
      navigate('queue')
    },
    onError: (e) =>
      toast.show({
        title: 'Não foi possível programar',
        body: e instanceof Error ? e.message : undefined,
        tone: 'error'
      })
  })
  const discover = useMutation({
    mutationFn: ({ profileId, limit, source }: { profileId: string; limit: number; source: ProfileContentSource }) =>
      call('profiles.discover', {
        workspaceId: workspace.id,
        profileId,
        limit,
        source
      }),
    onSuccess: (_, input) => {
      setProgressOpen(true)
      void qc.invalidateQueries()
      toast.show({
        title: `Carregando ${sourceLabels[input.source].toLowerCase()}`,
        body: 'A grade atualizará durante a busca. A grade cobre os itens retornados conforme o limite configurado; o provedor pode retornar menos.'
      })
    },
    onError: (e) =>
      toast.show({
        title: 'Perfil cadastrado; a busca não iniciou',
        body: e instanceof Error ? e.message : 'Verifique a API.',
        tone: 'error'
      })
  })
  const selectedDownload = useMutation({
    mutationFn: () =>
      call('profiles.downloadSelected', {
        workspaceId: workspace.id,
        postIds: ids
      }),
    onSuccess: () => {
      void qc.invalidateQueries()
      navigate('queue')
    },
    onError: (e) =>
      toast.show({
        title: 'Não foi possível baixar',
        body: e instanceof Error ? e.message : undefined,
        tone: 'error'
      })
  })
  const prepare = useMutation({
    mutationFn: () =>
      call('profiles.prepareSelected', {
        workspaceId: workspace.id,
        postIds: ids
      }),
    onSuccess: (assetIds) => {
      setComposeSelection(assetIds)
      navigate('compose')
    },
    onError: (e) =>
      toast.show({
        title: 'Lote não disponível',
        body: e instanceof Error ? e.message : undefined,
        tone: 'error'
      })
  })
  const downloadStatus = useQuery({
    queryKey: ['downloadStatus', workspace.id],
    queryFn: () =>
      call('profiles.downloadStatus', { workspaceId: workspace.id })
  })
  const download = useMutation({
    mutationFn: () =>
      call('profiles.download', {
        workspaceId: workspace.id,
        profileId: active!.id,
        limit: Number(downloadLimit)
      }),
    onSuccess: () => {
      setDownloadOpen(false)
      void qc.invalidateQueries()
      toast.show({
        title: 'Busca adicionada à fila',
        body: 'Os vídeos disponíveis serão baixados para a Biblioteca. Acompanhe na Fila.'
      })
    },
    onError: (e) =>
      toast.show({
        title: 'Não foi possível iniciar',
        body: e instanceof ApiError ? e.message : 'Tente novamente.',
        tone: 'error'
      })
  })

  const grid = useGridQuery(
    {
      workspaceId: workspace.id,
      source: 'remote',
      profileId: active?.id,
      sortBy,
      sortDir,
      text: text || undefined,
      hashtag: hashtag || undefined,
      minViews: minViews ? Number(minViews) : undefined,
      minLikes: minLikes ? Number(minLikes) : undefined,
      minComments: minComments ? Number(minComments) : undefined,
      mediaKind
    },
    Boolean(active),
    gridPage,
    gridPageSize
  )

  const activeFilters: ActiveFilter[] = [
    ...(text ? [{ key: 'text', label: 'Legenda: ' + text, clear: () => setText('') }] : []),
    ...(hashtag ? [{ key: 'hashtag', label: 'Hashtag: ' + hashtag, clear: () => setHashtag('') }] : []),
    ...(minViews ? [{ key: 'views', label: 'Views ≥ ' + Number(minViews).toLocaleString('pt-BR'), clear: () => setMinViews('') }] : []),
    ...(minLikes ? [{ key: 'likes', label: 'Curtidas ≥ ' + Number(minLikes).toLocaleString('pt-BR'), clear: () => setMinLikes('') }] : []),
    ...(minComments ? [{ key: 'comments', label: 'Comentários ≥ ' + Number(minComments).toLocaleString('pt-BR'), clear: () => setMinComments('') }] : []),
    ...(mediaKind !== 'all' ? [{ key: 'kind', label: mediaKind === 'videos' ? 'Vídeos/reels' : 'Fotos/carrosséis', clear: () => setMediaKind('all') }] : [])
  ]
  const clearFilters = () => { setText(''); setHashtag(''); setMinViews(''); setMinLikes(''); setMinComments(''); setMediaKind('all') }

  const knownItems = new Map([...topItems, ...grid.items].map((i) => [i.id, i]))
  const missingVideo = ids.some((id) => !knownItems.get(id)?.assetId)

  useMascotSignal(
    scheduleOpen && !schedule.isPending,
    'approval',
    'Revise e confirme o agendamento do Instagram.'
  )
  useMascotSignal(
    downloadOpen && !download.isPending,
    'question',
    'Escolha quantos vídeos deseja buscar do perfil.'
  )
  useMascotSignal(
    reelOpen,
    'question',
    'Informe o link do reel para continuar.'
  )
  useMascotSignal(
    Boolean(active) && grid.isFetching,
    'searching',
    'Consultando os posts e suas métricas disponíveis.'
  )

  useEffect(() => {
    setSelection(emptySelection())
    setGridPage(1)
  }, [
    active?.id,
    sortBy,
    sortDir,
    text,
    hashtag,
    minViews,
    minLikes,
    minComments,
    mediaKind
  ])
  const selectTop = useMutation({
    mutationFn: () =>
      call('grid.query', {
        workspaceId: workspace.id,
        source: 'remote',
        profileId: active!.id,
        sortBy,
        sortDir: 'desc',
        limit: Number(topCount),
        offset: 0,
        text: text || undefined,
        hashtag: hashtag || undefined,
        mediaKind,
        minViews:
          sortBy === 'views'
            ? Math.max(0, Number(minViews))
            : minViews
              ? Number(minViews)
              : undefined,
        minLikes:
          sortBy === 'likes'
            ? Math.max(0, Number(minLikes))
            : minLikes
              ? Number(minLikes)
              : undefined,
        minComments:
          sortBy === 'comments'
            ? Math.max(0, Number(minComments))
            : minComments
              ? Number(minComments)
              : undefined
      }),
    onMutate: () => setSortDir('desc'),
    onSuccess: (page) => {
      setTopItems(page.items)
      setSelection({ mode: 'ids', ids: new Set(page.items.map((i) => i.id)) })
      toast.show({
        title: `${page.items.length} resultados selecionados`,
        body: 'Ranking dos posts carregados com a métrica escolhida disponível.'
      })
    },
    onError: (e) =>
      toast.show({
        title: 'Não foi possível selecionar',
        body: e instanceof Error ? e.message : undefined,
        tone: 'error'
      })
  })

  const add = useMutation({
    mutationFn: () =>
      call('profiles.add', { workspaceId: workspace.id, url: url.trim() }),
    onSuccess: (p) => {
      setUrl('')
      setUrlError(undefined)
      setActiveId(p.id)
      void qc.invalidateQueries({ queryKey: ['profiles'] })
      void qc.invalidateQueries({ queryKey: ['profiles-archived', workspace.id] })
      if (downloadStatus.data?.configured) {
        if (p.platform === 'instagram') profileRefresh.mutate(p.id)
        discover.mutate({
          profileId: p.id,
          source: p.platform === 'instagram' ? newSource : 'posts',
          limit: Math.min(1000, Math.max(1, Number(discoveryLimit)))
        })
      } else
        toast.show({
          title: 'Perfil cadastrado',
          body: 'Configure Apify na Visão geral para carregar a grade.'
        })
    },
    onError: (e) =>
      setUrlError(
        e instanceof ApiError ? e.message : 'Não foi possível adicionar.'
      )
  })
  const addReel = useMutation({
    mutationFn: () =>
      call('profiles.addReel', {
        workspaceId: workspace.id,
        profileId: active!.id,
        url: reelUrl
      }),
    onSuccess: () => {
      setReelOpen(false)
      setReelUrl('')
      setReelError(undefined)
      void qc.invalidateQueries()
    },
    onError: (e) =>
      setReelError(
        e instanceof ApiError ? e.message : 'Não foi possível adicionar.'
      )
  })
  const importFile = useMutation({
    mutationFn: () =>
      call('profiles.importMetricsFile', {
        workspaceId: workspace.id,
        profileId: active!.id
      }),
    onSuccess: (r) => {
      if (!r) return
      void qc.invalidateQueries()
      const errors = r.rows.filter((x) => x.error)
      toast.show({
        title: `${r.upserted} posts atualizados`,
        body: errors.length
          ? `${errors.length} linha(s) ignorada(s): ${errors
              .slice(0, 3)
              .map((x) => `linha ${x.line} (${x.error})`)
              .join('; ')}`
          : undefined,
        tone: errors.length ? 'error' : 'info'
      })
    },
    onError: (e) =>
      toast.show({
        title: 'Importação falhou',
        body: e instanceof ApiError ? e.message : undefined,
        tone: 'error'
      })
  })

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden xl:flex-row">
      <ProfileSidebar>
        <form
          data-tour="profile-url"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (
              url.trim() &&
              Number(discoveryLimit) >= 1 &&
              Number(discoveryLimit) <= 1000 &&
              Number.isInteger(Number(discoveryLimit)) &&
              !add.isPending &&
              !discover.isPending &&
              !importing
            ) {
              setProgressOpen(true)
              add.mutate()
            }
          }}
        >
          <Popover.Root open={progressOpen} onOpenChange={setProgressOpen}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="Link do perfil"
                  placeholder="@legacy"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  error={urlError}
                />
              </div>
              <Popover.Anchor asChild>
                <span className="shrink-0">
                  {importing ? <ActionIcon
                    label="Cancelar importação"
                    type="button"
                    variant="primary"
                    loading={cancelImport.isPending}
                    className="import-cancel group/import w-9 px-0 hover:bg-danger hover:text-white focus-visible:bg-danger focus-visible:text-white"
                    onClick={() => cancelImport.mutate(active!.id)}
                  >
                    {!cancelImport.isPending && <>
                      <span className="group-hover/import:hidden group-focus-visible/import:hidden"><Spinner label="Importando perfil" /></span>
                      <Pause size={16} aria-hidden className="hidden group-hover/import:block group-focus-visible/import:block" />
                    </>}
                  </ActionIcon> : <ActionIcon
                    label="Importar perfil"
                    type="button"
                    variant="primary"
                    disabledReason={
                      !Number.isInteger(Number(discoveryLimit)) ||
                      Number(discoveryLimit) < 1 ||
                      Number(discoveryLimit) > 1000
                        ? 'Use um limite entre 1 e 1000 posts.'
                        : undefined
                    }
                    className="w-9 px-0"
                    onClick={() => {
                      if (add.isPending || discover.isPending || (!url.trim() && progress.data))
                        setProgressOpen(true)
                      else if (url.trim()) {
                        setProgressOpen(true)
                        add.mutate()
                      }
                    }}
                  >
                    {add.isPending || discover.isPending ? (
                      <Spinner label="Importando perfil" />
                    ) : (
                      <UserSearch size={16} />
                    )}
                  </ActionIcon>}
                </span>
              </Popover.Anchor>
            </div>
            {importing && !progressOpen && <button type="button" onClick={() => setProgressOpen(true)} className="flex items-center gap-1.5 self-start text-[11px] text-dim hover:text-fg">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-tone-orange" />
              {progress.data?.progress?.total != null ? `Importando · ${progress.data.progress.processed} de ${progress.data.progress.total}` : 'Importando perfil…'}
              <span className="underline">Ver andamento</span>
            </button>}
            <Popover.Portal>
              <Popover.Content
                className="ds-dropdown w-72 p-4"
                side="right"
                align="start"
                sideOffset={8}
                role="dialog"
                aria-label="Andamento da importação"
              >
                <h2 className="text-sm font-semibold">Importação do perfil</h2>
                {add.isPending || discover.isPending ? (
                  <p className="mt-2 text-xs text-dim">Registrando a busca…</p>
                ) : urlError ? (
                  <p role="alert" className="mt-2 text-xs text-danger-fg">
                    {urlError}
                  </p>
                ) : progress.isError ? (
                  <p role="alert" className="mt-2 text-xs text-danger-fg">
                    Não foi possível consultar o andamento.
                  </p>
                ) : !progress.data ? (
                  <p className="mt-2 text-xs text-dim">
                    {add.isPending || discover.isPending
                      ? 'Registrando perfil…'
                      : 'Cadastre um perfil e configure Apify para carregar a grade.'}
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 text-xs" aria-live="polite">
                    <p>
                      {progress.data.state === 'queued'
                        ? 'Aguardando na fila'
                        : progress.data.state === 'running'
                          ? progress.data.progress?.total === null ||
                            !progress.data.progress
                            ? 'Buscando posts na Apify…'
                            : 'Carregando a grade'
                          : progress.data.state === 'done'
                            ? 'Grade carregada'
                            : progress.data.state === 'cancelled'
                              ? 'Importação cancelada'
                              : 'Importação interrompida'}
                    </p>
                    {progress.data.progress?.total !== null &&
                    progress.data.progress?.total !== undefined ? (
                      <>
                        <progress
                          className="legacy-first-progress h-1.5 w-full"
                          value={progress.data.progress.percent ?? 0}
                          max={100}
                          aria-label="Posts processados"
                        />
                        <p>
                          {progress.data.progress.processed} de{' '}
                          {progress.data.progress.total} posts processados ·{' '}
                          {progress.data.progress.percent}%
                        </p>
                        <p className="text-dim">
                          {progress.data.progress.imported} importados ·{' '}
                          {progress.data.progress.skipped} ignorados
                          {Boolean(progress.data.progress.previewFailures) &&
                            ` · ${progress.data.progress.previewFailures} prévias indisponíveis`}
                        </p>
                      </>
                    ) : (
                      importing && <Spinner label="Buscando posts" />
                    )}
                    {progress.data.error && progress.data.state !== 'cancelled' && (
                      <p className="text-danger-fg">{progress.data.error}</p>
                    )}
                    {importing && <Button size="sm" variant="danger" icon={<Pause size={13} aria-hidden />} loading={cancelImport.isPending} onClick={() => cancelImport.mutate(active!.id)}>Cancelar importação</Button>}
                    {progress.data.state === 'cancelled' && <p className="text-dim">Os posts já importados continuam na grade. Importe de novo para continuar.</p>}
                    {progress.data.state === 'failed' && (
                      <Button size="sm" onClick={() => navigate('queue')}>
                        Ver tarefa na fila
                      </Button>
                    )}
                  </div>
                )}
                <Popover.Close asChild>
                  <button className="mt-3 text-xs text-dim underline">
                    Fechar
                  </button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <ContentSourcePicker fullWidth label="Origem do conteúdo (Instagram)" value={newSource} onChange={setNewSource} />
          <Input
            label="Limite de posts para analisar"
            type="number"
            min={1}
            max={1000}
            value={discoveryLimit}
            onChange={(e) => setDiscoveryLimit(e.target.value)}
          />
          <p className="text-[11px] text-dim">
            {newSource === 'all' ? 'Todos consulta três fontes na Apify, com limite total de resultados.' : 'A Apify buscará a origem escolhida até o limite configurado.'}
          </p>
        </form>
        {[...new Set(profiles.data?.map((p) => p.platform) ?? [])].map(
          (platform) => (
            <section key={platform} className="w-full min-w-0" aria-label={`Perfis ${platform}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium text-dim">
                {{
                  instagram: 'Instagram',
                  tiktok: 'TikTok',
                  youtube: 'YouTube'
                }[platform] ?? platform}
              </h2>
              {platform === 'instagram' && <button type="button" aria-label="Atualizar dados de todos os perfis do Instagram" title="Atualizar dados de todos os perfis do Instagram" disabled={refresh.isPending || profileRefresh.isPending} onClick={() => refresh.mutate()} className="flex size-8 shrink-0 items-center justify-center rounded-ctl text-dim hover:bg-raised hover:text-fg disabled:opacity-50"><RefreshCw size={14} aria-hidden className={refresh.isPending ? 'animate-spin' : undefined} /></button>}
              </div>
              <ul className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
                {profiles.data
                  ?.filter((p) => p.platform === platform)
                  .map((p) => (
                    <ProfileListItem key={p.id} profile={p} active={active?.id === p.id}
                      disabled={archive.isPending}
                      onSelect={() => setActiveId(p.id)}
                      onArchive={() => archive.mutate({ profileId: p.id, archived: true })} />
                  ))}
              </ul>
            </section>
          )
        )}
        {!!profiles.data?.length && <p className="text-[11px] text-dim">Arraste um perfil para a direita para arquivar.</p>}
        {!!archivedProfiles.data?.length && <CollapsibleCard className="archived-profiles" title={<span className="flex items-center gap-2"><Archive size={14} aria-hidden />Perfis arquivados</span>} open={archivedOpen} onOpenChange={setArchivedOpen}>
          <ul className="flex flex-col gap-2">
            {archivedProfiles.data.map(p => <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
              <span className="truncate">@{p.username}</span>
              <Button size="sm" disabled={archive.isPending} onClick={() => archive.mutate({ profileId: p.id, archived: false })}>Restaurar</Button>
            </li>)}
          </ul>
        </CollapsibleCard>}
      </ProfileSidebar>
      <section
        data-tour="profiles-content"
        className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 xl:w-auto xl:p-6"
      >
        {!active ? (
          <EmptyState
            icon={<UserSearch size={28} />}
            title="Acompanhe um perfil"
            body="Cole o link de um perfil público do Instagram ou TikTok para importar vídeos via Apify, ou importar links e métricas."
          />
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-3">
              <div className="flex w-full items-center gap-3">
                <ProfileAvatar key={active.id} username={active.username} path={active.avatarPath} size="lg" />
                <div className="min-w-0">
                <h1 className="text-lg font-semibold">@{active.username}</h1>
                <p className="text-xs text-dim">
                  <strong className="font-semibold">{formatProfileCount(active.metrics?.postsCount)} posts</strong>
                  {' · '}{formatProfileCount(active.metrics?.followersCount)} seguidores
                  {' · '}{formatProfileCount(active.metrics?.followingCount)} seguindo
                  {' · '}{formatProfileCount(active.metrics?.reelsCount)} reels
                </p>
                {profileRefresh.isPending && profileRefresh.variables === active.id && <p role="status" className="text-xs text-dim">Carregando métricas do perfil…</p>}
                {active.lastSyncedAt && (
                  <p className="text-xs text-dim">
                    Última busca:{' '}
                    {new Date(active.lastSyncedAt).toLocaleDateString('pt-BR', {
                      timeZone: workspace.timeZone
                    })}{' · '}{new Date(active.lastSyncedAt).toLocaleTimeString('pt-BR', {
                      timeZone: workspace.timeZone
                    })}
                  </p>
                )}
                </div>
              </div>
            </header>
            <div role="toolbar" aria-label="Ações do perfil" className="ds-profile-toolbar">
              <div className="flex flex-wrap items-center gap-2">
                {active.platform === 'instagram' && <><span className="text-xs text-dim">Origem</span>
                  <ContentSourcePicker label="Origem da atualização" value={activeSource} onChange={(source) => setSourceOverrides(prev => ({ ...prev, [active.id]: source }))} />
                  <span className="min-w-16 text-xs font-medium">{sourceLabels[activeSource]}</span></>}
                <Button size="sm" variant="primary"
                  disabledReason={!downloadStatus.data?.configured ? 'Configure a Apify na Visão geral para buscar posts.' : importing ? 'Uma importação já está em andamento.' : !Number.isInteger(Number(discoveryLimit)) || Number(discoveryLimit) < 1 || Number(discoveryLimit) > 1000 ? 'Use um limite entre 1 e 1000 posts.' : undefined}
                  disabled={discover.isPending}
                  onClick={() => discover.mutate({ profileId: active.id, source: activeSource, limit: Number(discoveryLimit) })}>
                  Atualizar grade
                </Button>
              </div>
              <span aria-hidden className="h-6 w-px bg-line" />
              <div className="flex flex-wrap items-center gap-2">
                {active.platform === 'instagram' && <Button size="sm" icon={<RefreshCw size={13} />} loading={profileRefresh.isPending && profileRefresh.variables === active.id}
                  disabledReason={!downloadStatus.data?.configured ? 'Configure a Apify na Visão geral.' : undefined}
                  disabled={refresh.isPending || profileRefresh.isPending}
                  onClick={() => profileRefresh.mutate(active.id)}>Atualizar métricas</Button>}
                <Button size="sm" aria-label="Baixar vídeos do perfil" icon={<Download size={13} />} onClick={() => setDownloadOpen(true)}>Baixar vídeos</Button>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <ActionIcon size="sm" variant="ghost" label="Ver fila" onClick={() => navigate('queue')}><ListOrdered size={15} /></ActionIcon>
                <ActionIcon size="sm" variant="ghost" label="Adicionar link de reel" onClick={() => setReelOpen(true)}><Link2 size={15} /></ActionIcon>
                <ActionIcon size="sm" variant="ghost" label="Importar métricas (CSV/JSON)" onClick={() => importFile.mutate()}><FileUp size={15} /></ActionIcon>
              </div>
            </div>
            <section aria-label="Filtros dos posts" className="ds-filter-card shrink-0">
              <FilterBar label="Filtrar posts" actions={
                <SortMenu<Sort> value={sortBy} onChange={setSortBy} direction={sortDir} onDirection={setSortDir} options={[
                  { value: 'views', label: 'Visualizações', directions: ['Mais vistos primeiro', 'Menos vistos primeiro'] },
                  { value: 'likes', label: 'Curtidas', directions: ['Mais curtidos primeiro', 'Menos curtidos primeiro'] },
                  { value: 'comments', label: 'Comentários', directions: ['Mais comentados primeiro', 'Menos comentados primeiro'] },
                  { value: 'postedAt', label: 'Data de publicação', directions: ['Recentes primeiro', 'Antigos primeiro'] }
                ]} />
              }>
                <FilterSearch label="Texto na legenda" placeholder="Buscar palavras na legenda" value={text} onChange={setText} />
                <FacetFilter label="Tipo de mídia" value={mediaKind === 'all' ? [] : [mediaKind]} onChange={v => setMediaKind((v[0] ?? 'all') as typeof mediaKind)} options={[{ value: 'videos', label: 'Vídeos/reels' }, { value: 'images', label: 'Fotos/carrosséis' }]} />
                <FilterPopover label="Filtros avançados" width={420} count={[hashtag, minViews, minLikes, minComments].filter(Boolean).length} total={grid.total} onReset={() => { setHashtag(''); setMinViews(''); setMinLikes(''); setMinComments('') }}>
                  <FilterSection title="Conteúdo">
                    <Input label="Hashtag" placeholder="#viagem" value={hashtag} onChange={e => setHashtag(e.target.value)} className="w-full" />
                  </FilterSection>
                  <FilterSection title="Desempenho mínimo">
                    <ChipGroup label="Views mínimas rápidas" value={['', '1000', '10000', '100000', '1000000'].includes(minViews) ? minViews || 'any' : 'custom'} onChange={v => v !== 'custom' && setMinViews(v === 'any' ? '' : v)} options={[{ value: 'any', label: 'Qualquer' }, { value: '1000', label: '1 mil+' }, { value: '10000', label: '10 mil+' }, { value: '100000', label: '100 mil+' }, { value: '1000000', label: '1 mi+' }]} />
                    <div className="grid grid-cols-3 items-end gap-3">
                      <Input label="Mínimo de views" placeholder="Sem mínimo" type="number" min={0} value={minViews} onChange={e => setMinViews(e.target.value.replace(/\D/g, ''))} className="w-full" />
                      <Input label="Mínimo de curtidas" placeholder="Sem mínimo" type="number" min={0} value={minLikes} onChange={e => setMinLikes(e.target.value.replace(/\D/g, ''))} className="w-full" />
                      <Input label="Mínimo de comentários" placeholder="Sem mínimo" type="number" min={0} value={minComments} onChange={e => setMinComments(e.target.value.replace(/\D/g, ''))} className="w-full" />
                    </div>
                  </FilterSection>
                </FilterPopover>
              </FilterBar>
              <FilterPresets presets={[
                { id: 'viral', label: 'Virais (100 mil+ views)', active: minViews === '100000' && !minLikes && !minComments, apply: () => { clearFilters(); setMinViews('100000'); setSortBy('views') } },
                { id: 'talk', label: 'Muito comentados (100+)', active: minComments === '100' && !minViews && !minLikes, apply: () => { clearFilters(); setMinComments('100'); setSortBy('comments') } },
                { id: 'loved', label: 'Muito curtidos (10 mil+)', active: minLikes === '10000' && !minViews && !minComments, apply: () => { clearFilters(); setMinLikes('10000'); setSortBy('likes') } },
                { id: 'videos', label: 'Só vídeos recentes', active: mediaKind === 'videos' && sortBy === 'postedAt', apply: () => { clearFilters(); setMediaKind('videos'); setSortBy('postedAt'); setSortDir('desc') } }
              ]} />
              <ActiveFilters filters={activeFilters} total={grid.total} noun="posts" onClear={clearFilters} />
            </section>
            <SelectionBar count={selectionCount(selection)} label={selectionLabel(selection)} onClear={() => setSelection(emptySelection())}
              hint="Selecione posts (ou Ctrl + clique nos cards) para baixar os vídeos, preparar um lote ou programar no Instagram."
              helpers={<>
                <Button size="sm" variant="ghost" onClick={() => setSelection(selectPage(selection, grid.items.map((i) => i.id)))}>Selecionar página</Button>
                <span aria-hidden className="h-5 w-px bg-line" />
                <span className="text-xs text-dim">Melhores</span>
                <Input aria-label="Quantidade de virais" type="number" min={1} max={100} value={topCount} onChange={(e) => setTopCount(e.target.value)} className="w-24" />
                <Button size="sm"
                  disabledReason={sortBy === 'postedAt' ? 'Ordene por visualizações, curtidas ou comentários para escolher os melhores.' : undefined}
                  disabled={selectTop.isPending || !Number.isInteger(Number(topCount)) || Number(topCount) < 1 || Number(topCount) > 100}
                  onClick={() => selectTop.mutate()}>Selecionar top {topCount || 'X'}</Button>
              </>}
              actions={<>
                <Button size="sm" variant="primary" icon={<Download size={13} aria-hidden />} disabledReason={!ids.length ? 'Selecione posts desta grade.' : undefined} disabled={selectedDownload.isPending} onClick={() => selectedDownload.mutate()}>Baixar selecionados</Button>
                <Button size="sm" disabled={!selectionCount(selection) || prepare.isPending} onClick={() => prepare.mutate()}>Preparar lote selecionado</Button>
                <Button size="sm" disabledReason={!ids.length ? 'Selecione posts desta grade.' : undefined} onClick={() => setScheduleOpen(true)}>Programar selecionados</Button>
              </>} />
            {grid.isError ? (
              <p className="text-sm text-danger-fg">
                Não foi possível carregar os posts.{' '}
                {grid.error instanceof ApiError ? grid.error.message : ''}
              </p>
            ) : grid.items.length === 0 && !grid.isLoading ? (
              <EmptyState
                icon={null}
                title={activeFilters.length ? 'Nenhum post corresponde aos filtros' : 'Nenhum post ainda'}
                body={activeFilters.length ? 'Remova ou ajuste os filtros para encontrar outros posts.' : 'Adicione links de reels ou importe um CSV com permalink, views, likes e comments.'}
                action={activeFilters.length ? <Button onClick={clearFilters}>Limpar filtros</Button> : undefined}
              />
            ) : (
              <MediaGrid
                items={grid.items}
                loading={grid.isLoading}
                selection={selection}
                onToggleSelect={(id) => setSelection(previous => toggleId(previous, id))}
                onOpen={setPreview}
              />
            )}
            <Pagination className="rounded-card border border-line bg-panel" label="Paginação dos posts" page={gridPage} pageSize={gridPageSize} total={grid.total} busy={grid.isFetching} noun="posts" pageSizes={[30, 60, 120]} onPageSize={setGridPageSize} onPage={setGridPage} />
          </>
        )}
      </section>
      {preview && (
        <MediaPreview
          key={preview.id}
          item={preview}
          onClose={() => setPreview(null)}
        />
      )}
      {repost.modal}
      <Modal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        title="Programar reels selecionados"
        description={`${ids.length} vídeo(s) para publicação no Instagram.`}
        footer={
          <>
            <Button onClick={() => setScheduleOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={
                missingVideo ||
                !!deliveryError(
                  scheduleAt,
                  workspace.timeZone,
                  new Date(),
                  ids.length,
                  Number(intervalMin)
                ) ||
                !account.data ||
                schedule.isPending ||
                (ids.length > 1 &&
                  (Number(intervalMin) < 15 ||
                    Number(intervalMin) > 10080 ||
                    !Number.isInteger(Number(intervalMin))))
              }
              onClick={() => void repost.review({ postIds: ids }, allow => schedule.mutate(allow))}
            >
              Confirmar agendamento
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {missingVideo && (
            <p role="status" className="text-sm text-warn">
              Baixe os vídeos selecionados antes de programar. O Instagram
              publica a cópia local.
            </p>
          )}
          <p className="text-sm">
            {account.data
              ? `Destino: @${account.data.username}`
              : 'Conecte uma conta profissional em Contas.'}
          </p>
          {!account.data && (
            <Button
              onClick={() => {
                setScheduleOpen(false)
                navigate('accounts')
              }}
            >
              Conectar conta
            </Button>
          )}
          <DeliveryTime
            value={scheduleAt}
            onChange={setScheduleAt}
            timeZone={workspace.timeZone}
            count={ids.length}
            intervalMin={Number(intervalMin)}
          />
          {ids.length > 1 && (
            <Input
              label="Intervalo entre posts (minutos)"
              type="number"
              min={15}
              max={10080}
              value={intervalMin}
              onChange={(e) => setIntervalMin(e.target.value)}
            />
          )}
          <Input
            label="Legenda do lote (opcional)"
            maxLength={2200}
            value={scheduleCaption}
            onChange={(e) => setScheduleCaption(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={shareToFeed}
              onChange={(e) => setShareToFeed(e.target.checked)}
            />
            Mover para a aba posts (o reel também aparece na grade do perfil)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={cleanupAfterPublish}
              onChange={(e) => setCleanupAfterPublish(e.target.checked)}
            />
            Apagar a cópia do Legacy após publicação confirmada
          </label>
          <p className="text-xs text-dim">
            O histórico por conta permanece. Vídeos em uso por outras tarefas
            serão mantidos; o original importado não é apagado.
          </p>
          {grid.items.some(
            (i) =>
              ids.includes(i.id) &&
              i.publishedAccounts?.includes(account.data?.username ?? '')
          ) && (
            <p role="status" className="text-xs text-warn">
              Esta conta já publicou um ou mais vídeos selecionados. Revise a
              seleção antes de confirmar.
            </p>
          )}
          <p className="text-xs text-dim">
            Ao confirmar, serão criadas tarefas de publicação real, com a cópia
            local dos vídeos e esta legenda (ou a original se o campo estiver
            vazio). O PC precisa estar ligado e o Legacy aberto. Erros e
            retentativas ficam na Fila. Cancelar é possível enquanto a tarefa
            não começou.
          </p>
        </div>
      </Modal>
      <Modal
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        title="Baixar vídeos do perfil"
        description={`Buscar reels públicos de @${active?.username ?? ''} e salvar na Biblioteca.`}
        footer={
          <>
            <Button onClick={() => setDownloadOpen(false)}>Fechar</Button>
            <Button
              variant="primary"
              disabled={
                !downloadStatus.data?.configured ||
                download.isPending ||
                !Number.isInteger(Number(downloadLimit)) ||
                Number(downloadLimit) < 1 ||
                Number(downloadLimit) > 100
              }
              onClick={() => download.mutate()}
            >
              {download.isPending ? 'Adicionando…' : 'Buscar e baixar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Máximo de vídeos"
            type="number"
            min={1}
            max={100}
            value={downloadLimit}
            onChange={(e) => setDownloadLimit(e.target.value)}
          />
          <p className="text-sm text-dim">
            De 1 a 100 reels por busca. A Apify cobra conforme seu plano. O
            limite inclui vídeos já baixados; a busca pode retornar menos
            resultados. Os filtros e a seleção da grade não se aplicam a esta
            busca.
          </p>
          <p className="text-sm text-dim">
            Cada download aparece na Fila. Arquivos já importados são
            reutilizados. Links expirados exigem uma nova busca do perfil.
          </p>
          {!downloadStatus.data?.configured && (
            <>
              <p role="status" className="text-sm text-warn">
                {downloadStatus.isError
                  ? 'Não foi possível verificar a configuração. Reabra esta tela para tentar novamente.'
                  : downloadStatus.isLoading
                    ? 'Verificando configuração…'
                    : 'Cadastre a chave Apify na Visão geral. APIFY_TOKEN no ambiente também é aceito.'}
              </p>
              <Button
                onClick={() => {
                  setDownloadOpen(false)
                  navigate('overview')
                }}
              >
                Configurar API na Visão geral
              </Button>
            </>
          )}
        </div>
      </Modal>
      <Modal
        open={reelOpen}
        onOpenChange={(o) => {
          setReelOpen(o)
          if (!o) {
            setReelUrl('')
            setReelError(undefined)
          }
        }}
        title="Adicionar link de reel"
        description="O link fica guardado como referência. O vídeo não é baixado."
        footer={
          <>
            <Button
              onClick={() => {
                setReelOpen(false)
                setReelUrl('')
                setReelError(undefined)
              }}
            >
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => addReel.mutate()}>
              Adicionar
            </Button>
          </>
        }
      >
        <Input
          label="Link do reel"
          placeholder="instagram.com/reel/… ou tiktok.com/@usuario/video/…"
          value={reelUrl}
          onChange={(e) => setReelUrl(e.target.value)}
          error={reelError}
        />
      </Modal>
    </div>
  )
}

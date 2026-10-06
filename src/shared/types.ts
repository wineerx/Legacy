export type Origin = 'pc' | 'ig_own' | 'ig_third_party' | 'link_ref'
export type GridMetric = 'views' | 'likes' | 'comments'
export type SortKey = GridMetric | 'postedAt' | 'importedAt' | 'durationMs'
export type SortDir = 'asc' | 'desc'
export type Badge = 'baixado' | 'agendado' | 'publicado' | 'link' | 'favorito' | 'exportado'

export interface GridItem {
  id: string
  filePath?: string | null
  kind: 'asset' | 'remote'
  videoUrl?: string | null
  postId?: string | null
  assetId?: string | null
  mediaType?: string | null
  firstFramePath?: string | null
  thumbnailPath: string | null
  permalink: string | null
  caption: string | null
  postedAt: string | null
  durationMs: number | null
  metrics: Record<GridMetric, number | null>
  badges: Badge[]
  publishedAccounts?: string[]
  sourceProfile?: string | null
  status?: MediaState
  sizeBytes?: number
  importedAt?: string
  metricsUpdatedAt?: string | null
}

export const MEDIA_STATE_LABELS: Record<string, string> = { ready: 'Pronto', processing: 'Processando', scheduled: 'Agendado', published: 'Publicado', failed: 'Falhou', queued: 'Aguardando', running: 'Em execução', exported: 'Exportado para publicação manual' }
export type MediaState = 'ready' | 'processing' | 'scheduled' | 'published' | 'failed'
export interface MediaUsage { id: string; platform: 'Instagram' | 'TikTok'; account: string | null; state: string; at: string; error: string | null }
export interface MediaDetails {
  name: string; sizeBytes: number; durationMs: number; width: number; height: number; audioCodec: string | null
  origin: string; sourceProfile: string | null; permalink: string | null; importedAt: string; metricsUpdatedAt: string | null
  publications: MediaUsage[]; publicationTotal: number
  timeline: { at: string; label: string }[]; bannerPath: string | null
}

export interface GridQuery {
  workspaceId: string
  source: 'library' | 'remote'
  profileId?: string
  sortBy: SortKey
  sortDir: SortDir
  text?: string
  hashtag?: string
  from?: string
  to?: string
  maxDurationMs?: number
  minViews?: number
  minLikes?: number
  minComments?: number
  favoritesOnly?: boolean
  mediaKind?: 'all' | 'videos' | 'images'
  status?: MediaState | 'unpublished'
  sourceProfile?: string
  publicationAccount?: string
  platform?: 'instagram' | 'tiktok'
  limit: number
  offset: number
}

export interface GridPage { items: GridItem[]; total: number; loadedNote: string }

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export type JobType = 'make_thumbnail' | 'apply_banner' | 'export_tiktok' | 'fetch_profile' | 'download_reel' | 'webhook_delivery' | 'publish_instagram'

export interface DashboardSummary {
  tasks: Record<JobState | 'total', number>
  library: { count: number; bytes: number }
  unread: number
  profiles: { id: string; username: string; lastSyncedAt: string | null; posts: number; downloaded: number; views: number | null; likes: number | null; comments: number | null; viewsKnown: number; likesKnown: number; commentsKnown: number; metricsUpdatedAt: string | null }[]
  recent: { id: string; label: string; state: JobState; updatedAt: string }[]
}
export interface IntegrationStatus {
  apify: { configured: boolean; source: 'saved' | 'environment' | 'none'; lastValidatedAt: string | null }
  secureStorage: boolean
  webhook: { enabled: boolean; url: string; events: ('job.done' | 'job.failed')[]; revision: string; hasSecret: boolean }
  notifications: { desktop: boolean; completed: boolean; failures: boolean }
}

export interface JobView {
  id: string
  workspaceId: string
  type: JobType
  state: JobState
  attempts: number
  maxAttempts: number
  runAt: string
  lastError: string | null
  label: string
  createdAt: string
  updatedAt: string
}

export interface CoverTextSpec {
  text: string
  position: 'top' | 'center' | 'bottom'
  fontSizePct: number
  color: string
  background: string | null
}
export interface QueuePageResult {
  items: (JobView & { batchId: string | null; account: string | null })[]
  total: number
  page: number
  pageSize: number
  counts: Record<JobState, number>
}

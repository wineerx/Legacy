export type Origin = 'pc' | 'ig_own' | 'ig_third_party' | 'tiktok_third_party' | 'link_ref'
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
  sourcePlatform?: string | null
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
  assetId?: string
  publicationJobId?: string
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
  recent: { id: string; label: string; state: JobState; updatedAt: string; runAt: string; media: string | null }[]
  /** Next scheduled, active Container that has not ended yet. */
  nextContainer: { id: string; name: string; plannedStartAt: string | null; plannedEndAt: string | null } | null
  /** Last quota reading of the active account; values are null when Meta was never read. */
  quota: { username: string; usage: number | null; total: number | null; durationSec: number | null; fetchedAt: string | null; freshness: 'fresh' | 'stale' | 'missing' } | null
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
  context?: QueueContext
}

export interface QueueContext {
  assetId?: string | null
  mediaId: string | null
  mediaName: string | null
  thumbnailPath: string | null
  source: string | null
  sourceProfileId: string | null
  sourceUrl: string | null
  sourcePlatform: 'instagram' | 'tiktok' | 'local' | null
  platform: 'instagram' | 'tiktok' | 'local' | 'webhook'
  destination: string | null
  workerId: string | null
  priority: number
  stage: string
  step: number | null
  steps: number | null
  stalled: boolean
  needsAttention: boolean
  retryAt: string | null
  publicationLimitUntil?: string | null
  /** Why the account waits: a refusal by Meta, or a recent Meta reading that showed no room. */
  publicationLimitCause?: 'meta_refusal' | 'quota_snapshot' | null
  /** Time of the Meta quota reading behind the estimate; null when the estimate has no valid reading. */
  publicationLimitCheckedAt?: string | null
  publicationLimitReading?: { usage: number; total: number; windowSec: number } | null
  lastAttemptAt: string | null
  leaseUntil: string | null
  errorCode: string | null
  sourceAvatarPath?: string | null
  errorProvider?: string | null
  errorStatus?: number | null
}

export interface CoverTextSpec {
  text: string
  position: 'top' | 'center' | 'bottom'
  fontSizePct: number
  color: string
  background: string | null
}
export interface QueuePageResult {
  items: (JobView & { publishedVideo?: { assetId: string | null; name: string } | null; batchId: string | null; account: string | null })[]
  total: number
  page: number
  pageSize: number
  counts: Record<JobState, number>
}

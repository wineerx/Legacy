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
  assetId?: string | null
  mediaType?: string | null
  thumbnailPath: string | null
  permalink: string | null
  caption: string | null
  postedAt: string | null
  durationMs: number | null
  metrics: Record<GridMetric, number | null>
  badges: Badge[]
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

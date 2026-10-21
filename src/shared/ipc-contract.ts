import type { DiagnosticEvent } from './diagnostics'
import { z } from 'zod'
import { templateInput, type TemplateDetail, type TemplatePage } from './visual-templates'
import { containerDraftInput, containerState, type ContainerDetail, type ContainerPage } from './publication-containers'
import type { VisualPreviewOverrides } from './container-visual'
import type { AchievementSummary } from './achievements'
import type { QuotaProjection } from './quota'
import type { PeakWindow, DistributionPlan } from './peak-windows'
import type { ContainerWindowView } from './container-window'
import type { DragPreview } from './container-drag'
import type { AgendaResult } from './agenda'
import type { AppErrorCode } from './errors'
import type { MediaDetails, GridPage, JobView, QueuePageResult, QueueContext, JobState, JobType, DashboardSummary, IntegrationStatus } from './types'

export const profileContentSource = z.enum(['posts', 'reels', 'tagged', 'all'])
export type ProfileContentSource = z.infer<typeof profileContentSource>
const ws = z.uuid()
export interface UpdateStatus { state: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error' | 'unsupported'; version: string | null; progress: number; message: string }
const id = z.string().min(1).max(64)
const containerMutation = z.object({ workspaceId: ws, containerId: z.uuid(), expectedRevision: z.number().int().min(1) })
const png = z.instanceof(Uint8Array).refine((b) => b.byteLength <= 20 * 1024 * 1024, 'Imagem acima de 20 MB.')
const coverText = z.object({
  text: z.string().max(120), position: z.enum(['top', 'center', 'bottom']),
  fontSizePct: z.number().min(2).max(20), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).nullable()
})

const templateRef = z.object({ workspaceId: ws, templateId: z.uuid() })
const templateMutation = templateRef.extend({ expectedRevision: z.number().int().positive() })
export const contract = {
  'templates.create': z.object({workspaceId:ws, requestId:z.uuid(), input:templateInput}),
  'templates.saveVersion': templateMutation.extend({requestId:z.uuid(), input:templateInput}),
  'templates.get': templateRef.extend({version:z.number().int().positive().optional()}),
  'templates.query': z.object({workspaceId:ws, status:z.enum(['active','archived','all']).default('active'), text:z.string().max(120).default(''), page:z.number().int().positive().default(1), pageSize:z.number().int().min(1).max(100).default(20)}),
  'templates.duplicate': templateRef.extend({requestId:z.uuid(), version:z.number().int().positive().optional()}),
  'templates.archive': templateMutation.extend({archived:z.boolean()}),
  'templates.delete': templateMutation,
  'containers.applyTemplate': containerMutation.extend({draft:containerDraftInput, templateId:z.uuid(), templateVersion:z.number().int().positive()}),
  'containers.create': z.object({ workspaceId: ws, requestId: z.uuid(), draft: containerDraftInput }),
  'containers.updateDraft': containerMutation.extend({ draft: containerDraftInput }),
  'containers.get': z.object({ workspaceId: ws, containerId: z.uuid(), page: z.number().int().min(1).max(1000000).default(1), pageSize: z.number().int().min(1).max(100).default(50) }),
  'containers.query': z.object({ workspaceId: ws, page: z.number().int().min(1).max(1000000).default(1), pageSize: z.number().int().min(1).max(100).default(50), state: containerState.optional(), states: z.array(containerState).min(1).max(7).optional(), destinationAccountId: z.string().regex(/^\d+$/).optional() }),
  'containers.schedule': containerMutation,
  'containers.previewOverrides': z.object({ workspaceId: ws, assetId: id, recipeVersionId: id.optional() }),
  'containers.pause': containerMutation,
  'containers.resume': containerMutation,
  'containers.cancel': containerMutation,
  'app.bootstrap': z.object({}),
  'diagnostics.snapshot': z.object({ workspaceId: ws }),
  'diagnostics.pipeline': z.object({ workspaceId: ws }),
  'diagnostics.export': z.object({ workspaceId: ws }),
  'diagnostics.queue': z.object({ workspaceId: ws, page: z.number().int().min(1).max(1000000) }),
  'notifications.delete': z.object({ workspaceId: ws, ids: z.array(id).max(1000).optional(), all: z.boolean().optional() }).refine(v => v.all || Boolean(v.ids?.length), 'Selecione notificações.'),
  'publications.checkRepost': z.object({ workspaceId: ws, accountId: z.string().min(1), postIds: z.array(id).max(1000).optional(), assetIds: z.array(id).max(1000).optional() }),
  'session.get': z.object({}),
  'session.enterGuest': z.object({}),
  'session.exit': z.object({}),
  'profiles.importProgress': z.object({ workspaceId: ws, profileId: id }),
  'profiles.cancelImport': z.object({ workspaceId: ws, profileId: id }),
  'publications.feedback': z.object({ workspaceId: ws }),
  'publications.acknowledge': z.object({ workspaceId: ws, ids: z.array(id).max(100) }),
  'dashboard.get': z.object({ workspaceId: ws }),
  'achievements.get': z.object({ workspaceId: ws }),
  'achievements.acknowledge': z.object({ workspaceId: ws, ids: z.array(z.string().max(40)).max(30) }),
  'publications.history': z.object({ workspaceId: ws }),
  'captions.top': z.object({ workspaceId: ws, sortBy: z.enum(['views', 'likes', 'comments']), profileId: id.optional() }),
  'tutorial.planGet': z.object({ workspaceId: ws }),
  'tutorial.planSave': z.object({ workspaceId: ws, username: z.string().max(30), niche: z.string().max(160), audience: z.string().max(160), bio: z.string().max(150), cadence: z.string().max(80) }),
  'integrations.get': z.object({ workspaceId: ws }),
  'integrations.saveApify': z.object({ workspaceId: ws, token: z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/) }),
  'integrations.removeApify': z.object({ workspaceId: ws }),
  'integrations.testApify': z.object({ workspaceId: ws }),
  'webhooks.save': z.object({ workspaceId: ws, enabled: z.boolean(), url: z.string().trim().max(2048), events: z.array(z.enum(['job.done', 'job.failed'])).min(1).max(2), secret: z.string().min(32).max(256).optional() }),
  'webhooks.test': z.object({ workspaceId: ws }),
  'webhooks.list': z.object({ workspaceId: ws }),
  'notifications.preferences': z.object({ workspaceId: ws, desktop: z.boolean(), completed: z.boolean(), failures: z.boolean() }),
  'notifications.test': z.object({ workspaceId: ws }),
  'notifications.markAllRead': z.object({ workspaceId: ws }),
  'workspaces.create': z.object({ name: z.string().min(1).max(80), timeZone: z.string().min(1) }),
  'library.pickAndImport': z.object({ workspaceId: ws }),
  'library.importPaths': z.object({ workspaceId: ws, paths: z.array(z.string().min(1).max(1024)).min(1).max(200) }),
  'library.details': z.object({ workspaceId: ws, id, offset: z.number().int().min(0).default(0) }),
  'library.pending': z.object({ workspaceId: ws }),
  'library.deleteMany': z.object({ workspaceId: ws, ids: z.array(id).min(1).max(200) }),
  'library.delete': z.object({ workspaceId: ws, id }),
  'library.setFavorite': z.object({ workspaceId: ws, id, favorite: z.boolean() }),
  'library.frame': z.object({ workspaceId: ws, assetId: id, atMs: z.number().int().min(0) }),
  'grid.query': z.object({
    workspaceId: ws, source: z.enum(['library', 'remote']), profileId: id.optional(), assetId: id.optional(), publicationJobId: id.optional(),
    sortBy: z.enum(['views', 'likes', 'comments', 'postedAt', 'importedAt', 'durationMs']), sortDir: z.enum(['asc', 'desc']),
    text: z.string().max(100).optional(), hashtag: z.string().max(100).optional(),
    from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
    maxDurationMs: z.number().int().positive().optional(), minViews: z.number().int().min(0).optional(),
    minLikes: z.number().int().min(0).optional(), minComments: z.number().int().min(0).optional(),
    status: z.enum(['ready', 'processing', 'scheduled', 'published', 'failed', 'unpublished']).optional(), sourceProfile: z.string().max(100).optional(), publicationAccount: z.string().max(100).optional(), platform: z.enum(['instagram', 'tiktok']).optional(), favoritesOnly: z.boolean().optional(), mediaKind: z.enum(['all', 'videos', 'images']).optional(), limit: z.number().int().min(1).max(200), offset: z.number().int().min(0)
  }),
  'profiles.refresh': z.object({ workspaceId: ws, profileId: id }),
  'profiles.list': z.object({ workspaceId: ws }),
  'storage.get': z.object({ workspaceId: ws }),
  'storage.choose': z.object({ workspaceId: ws }),
  'storage.reset': z.object({ workspaceId: ws }),
  'profiles.downloadStatus': z.object({ workspaceId: ws }),
  'profiles.download': z.object({ workspaceId: ws, profileId: id, limit: z.number().int().min(1).max(100) }),
  'profiles.discover': z.object({ workspaceId: ws, profileId: id, limit: z.number().int().min(1).max(1000), source: profileContentSource.optional() }),
  'profiles.downloadSelected': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100) }),
  'profiles.prepareSelected': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100) }),
  'accounts.instagram': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/).optional() }),
  'accounts.instagramList': z.object({ workspaceId: ws }),
  'accounts.setDefault': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/) }),
  'scheduler.windows.get': z.object({ workspaceId: ws }),
  'scheduler.windows.save': z.object({ workspaceId: ws, windows: z.array(z.unknown()).max(12) }),
  'agenda.range': z.object({ workspaceId: ws, from: z.iso.datetime(), to: z.iso.datetime(), accountId: z.string().regex(/^\d+$/).optional() }).refine(v => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 62 * 86_400_000, 'Intervalo da agenda inválido.'),
  'containers.window.get': z.object({ workspaceId: ws, containerId: z.uuid() }),
  'containers.window.adjust': z.object({ workspaceId: ws, containerId: z.uuid(), expectedRevision: z.number().int().positive(), kind: z.enum(['keep', 'reduce', 'move']), slots: z.array(z.object({ jobId: z.string().min(1).max(64), at: z.iso.datetime() })).max(1000) }),
  'containers.drag.preview': z.object({ workspaceId: ws, containerId: z.uuid(), startAt: z.iso.datetime() }),
  'containers.drag.apply': z.object({ workspaceId: ws, containerId: z.uuid(), expectedRevision: z.number().int().positive(), startAt: z.iso.datetime(), slots: z.array(z.object({ jobId: z.string().min(1).max(64), at: z.iso.datetime() })).max(1000) }),
  'containers.distribution.plan': z.object({ workspaceId: ws, containerIds: z.array(z.uuid()).min(1).max(50), fromDate: z.iso.date() }),
  'containers.distribution.apply': z.object({ workspaceId: ws, fromDate: z.iso.date(), items: z.array(z.object({ containerId: z.uuid(), expectedRevision: z.number().int().positive(), start: z.iso.datetime() })).min(1).max(50) }),
  'quota.get': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/), slots: z.array(z.iso.datetime()).max(1000).default([]) }),
  'quota.refresh': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/), slots: z.array(z.iso.datetime()).max(1000).default([]) }),
  'publications.schedule': z.object({ workspaceId:ws,batchId:z.uuid(),items:z.array(z.object({media:id,provider:z.literal('instagram'),destinationAccount:z.string().regex(/^\d+$/),accountRevision:z.string().min(1),publishAt:z.iso.datetime(),caption:z.string().max(2200),versionId:id.optional(),shareToFeed:z.boolean().default(true),allowRepost:z.boolean().default(false)})).min(1).max(1000) }),
  'compose.scheduleInstagram': z.object({ workspaceId: ws, assetIds: z.array(id).min(1).max(100), accountId: z.string().regex(/^\d+$/), accountRevision: z.string().min(1), firstAt: z.iso.datetime(), intervalMin: z.number().int().min(15).max(10080), captions: z.record(z.string(),z.string().max(2200)), allowRepost: z.boolean().optional(), cleanupAfterPublish: z.boolean().default(false), shareToFeed: z.boolean().default(true), versionIds: z.record(id, id).optional() }),
  'accounts.verifyInstagram': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/).optional() }),
  'accounts.connectInstagram': z.object({ workspaceId: ws, token: z.string().trim().min(20).max(4096).regex(/^[A-Za-z0-9_.-]+$/) }),
  'accounts.disconnectInstagram': z.object({ workspaceId: ws, accountId: z.string().regex(/^\d+$/).optional() }),
  'profiles.scheduleInstagram': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100), firstAt: z.iso.datetime(), intervalMin: z.number().int().min(15).max(10080), caption: z.string().max(2200).optional(), allowRepost: z.boolean().optional(), cleanupAfterPublish: z.boolean().default(false), shareToFeed: z.boolean().default(true) }),
  'profiles.archive': z.object({ workspaceId: ws, profileId: id, archived: z.boolean() }),
  'profiles.archived': z.object({ workspaceId: ws }),
  'profiles.add': z.object({ workspaceId: ws, url: z.string().min(1).max(300) }),
  'profiles.addReel': z.object({ workspaceId: ws, profileId: id, url: z.string().min(1).max(300) }),
  'profiles.importMetricsFile': z.object({ workspaceId: ws, profileId: id }),
  'remote.setFavorite': z.object({ workspaceId: ws, id, favorite: z.boolean() }),
  'covers.list': z.object({ workspaceId: ws }),
  'covers.createImage': z.object({ workspaceId: ws, name: z.string().max(80) }),
  'covers.createFrameText': z.object({ workspaceId: ws, name: z.string().max(80), frameMs: z.number().int().min(0), text: coverText }),
  'versions.saveCover': z.object({ workspaceId: ws, assetId: id, templateId: id, png }),
  'versions.requestBanner': z.object({ workspaceId: ws, assetId: id, png, startMs: z.number().int().min(0), endMs: z.number().int().positive() }),
  'versions.prepareVideo': z.object({ workspaceId: ws, assetId: id, banner: z.object({ png, startMs: z.number().int().min(0), endMs: z.number().int().positive() }).optional(), coverVersionId: id.optional() }).refine((i) => i.banner || i.coverVersionId, 'Escolha uma capa ou um banner.'),
  'versions.planVideo': z.object({ workspaceId: ws, assetId: id, banner: z.object({ png, startMs: z.number().int().min(0), endMs: z.number().int().positive() }).optional(), coverVersionId: id.optional() }).refine((i) => i.banner || i.coverVersionId, 'Escolha uma capa ou um banner.'),
  'export.tiktok': z.object({
    workspaceId: ws, assetIds: z.array(id).min(1).max(100), captions: z.record(z.string(), z.string().max(4000)),
    stripMetadata: z.boolean(), remindAt: z.array(z.iso.datetime().nullable())
  }).refine((v) => v.remindAt.length === v.assetIds.length, { message: 'Lembretes e vídeos não conferem.', path: ['remindAt'] }),
  'export.openFolder': z.object({ workspaceId: ws, path: z.string().min(1) }),
  'jobs.list': z.object({ workspaceId: ws }),
  'jobs.query': z.object({ workspaceId: ws, page: z.number().int().min(1).max(1000000), pageSize: z.number().int().min(5).max(100), search: z.string().max(160), state: z.enum(['queued','running','done','failed','cancelled']).optional(), type: z.enum(['make_thumbnail','apply_banner','export_tiktok','fetch_profile','download_reel','webhook_delivery','publish_instagram']).optional(), batchId: id.optional(), platform: z.enum(['instagram','tiktok','local','webhook']).optional(), source: z.string().max(160).optional(), destination: z.string().max(160).optional(), worker: z.literal('worker-local-01').optional(), priority: z.number().int().min(0).max(2).optional(), from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), error: z.string().max(160).optional(), retries: z.boolean().optional(), attention: z.boolean().optional(), sort: z.enum(['created','scheduled','priority']).optional() }),
  'jobs.health': z.object({ workspaceId: ws }),
  'jobs.pause': z.object({ workspaceId: ws, paused: z.boolean() }),
  'jobs.bulk': z.object({ workspaceId: ws, items: z.array(z.object({ id, updatedAt: z.iso.datetime() })).min(1).max(100), action: z.enum(['cancel','retry','run_now','priority','remove','recover']), priority: z.number().int().min(0).max(2).optional() }),
  'jobs.tail': z.object({ workspaceId: ws, id }),
  'jobs.reschedule': z.object({ workspaceId: ws, id, runAt: z.iso.datetime(), expectedUpdatedAt: z.iso.datetime() }),
  'jobs.details': z.object({ workspaceId: ws, id }),
  'library.saveCopy': z.object({ workspaceId: ws, id }),
  'library.openAsset': z.object({ workspaceId: ws, id }),
  'updates.status': z.object({}),
  'updates.check': z.object({}),
  'updates.download': z.object({}),
  'updates.install': z.object({}),
  'jobs.cancel': z.object({ workspaceId: ws, id }),
  'jobs.retry': z.object({ workspaceId: ws, id }),
  'notifications.list': z.object({ workspaceId: ws }),
  'notifications.markRead': z.object({ workspaceId: ws, id }),
  'settings.get': z.object({ workspaceId: ws, key: z.enum(['minimizeToTray', 'stripMetadataDefault', 'mediaViewList', 'mediaShowBanner', 'onboardingDismissed']) }),
  'settings.set': z.object({ workspaceId: ws, key: z.enum(['minimizeToTray', 'stripMetadataDefault', 'mediaViewList', 'mediaShowBanner', 'onboardingDismissed']), value: z.enum(['true', 'false']) }),
  'onboarding.status': z.object({ workspaceId: ws })
} as const

export type Channel = keyof typeof contract
export type Input<C extends Channel> = z.infer<(typeof contract)[C]>

export interface WorkspaceDto { id: string; name: string; timeZone: string }
export interface ImportResultDto { path: string; status: 'imported' | 'duplicate' | 'rejected'; assetId?: string; errors: string[]; warnings: string[] }
export interface GuestSessionDto { entered: boolean; email: 'guest@legacy.com'; mode: 'development' }
export interface ImportProgress { phase: 'searching' | 'importing' | 'done'; processed: number; total: number | null; imported: number; skipped: number; previewFailures: number; percent: number | null }
export interface ProfileMetrics { postsCount: number | null; reelsCount: number | null; followersCount: number | null; followingCount: number | null; updatedAt: string }
export interface ProfileDto { metrics?: ProfileMetrics | null; contentSource?: ProfileContentSource; avatarPath?: string | null; platform: string; id: string; username: string; url: string; connected: boolean; lastSyncedAt: string | null }
export interface CoverDto { id: string; name: string; kind: 'image' | 'frame_text'; imagePath: string | null; frameMs: number | null; textJson: string | null }
export interface NotificationDto { id: string; kind: 'info' | 'error' | 'manual_task'; title: string; body: string; actionJson: string | null; dueAt: string | null; readAt: string | null; createdAt: string }
export interface OnboardingStepDto { key: string; label: string; done: boolean; disabledReason?: string }

export interface Outputs {
  'templates.create': TemplateDetail
  'templates.saveVersion': TemplateDetail
  'templates.get': TemplateDetail
  'templates.query': TemplatePage
  'templates.duplicate': TemplateDetail
  'templates.archive': TemplateDetail
  'templates.delete': { deleted: boolean }
  'containers.applyTemplate': ContainerDetail
  'containers.create': ContainerDetail
  'containers.updateDraft': ContainerDetail
  'containers.get': ContainerDetail
  'containers.query': ContainerPage
  'containers.schedule': { detail: ContainerDetail; jobs: JobView[] }
  'containers.previewOverrides': VisualPreviewOverrides
  'containers.pause': ContainerDetail
  'containers.resume': ContainerDetail
  'containers.cancel': ContainerDetail
  'diagnostics.pipeline': import('./pipeline').PipelineSnapshot
  'publications.schedule': JobView[]
  'notifications.delete': { deleted: number }
  'publications.checkRepost': { id: string; name: string; reason: string }[]
  'session.get': GuestSessionDto
  'session.enterGuest': GuestSessionDto
  'session.exit': GuestSessionDto
  'profiles.importProgress': { jobId: string; state: string; error: string | null; progress: ImportProgress | null } | null
  'profiles.cancelImport': boolean
  'publications.feedback': { jobId: string; username: string }[]
  'publications.acknowledge': null
  'diagnostics.export': { saved: boolean },
  'diagnostics.queue': QueuePageResult
  'diagnostics.snapshot': { events: DiagnosticEvent[]; workerAlive: boolean; heartbeat: string | null; stages: Record<string, string>; retryCount: number; failedJobs: JobView[] },
  'app.bootstrap': { workspaces: WorkspaceDto[]; version: string; buildCommit?: string; buildTime?: string; workerAlive: boolean; dataDir: string }
  'dashboard.get': DashboardSummary
  'achievements.get': AchievementSummary & { acknowledged: string[] }
  'achievements.acknowledge': null
  'publications.history': { jobId: string; accountId: string; username: string; postId: string | null; assetSha: string | null; mediaId: string | null; provenanceJson: string; publishedAt: string; cleanupState: string }[]
  'captions.top': { items: { id: string; username: string; text: string | null; permalink: string; value: number | null; updatedAt: string | null; source: 'api' | 'csv' | null }[]; total: number; sortBy: 'views' | 'likes' | 'comments'; note: string }
  'tutorial.planGet': { username: string; niche: string; audience: string; bio: string; cadence: string } | null
  'tutorial.planSave': null
  'integrations.get': IntegrationStatus
  'integrations.saveApify': null
  'integrations.removeApify': null
  'integrations.testApify': { validatedAt: string }
  'webhooks.save': null
  'webhooks.test': JobView
  'webhooks.list': { id: string; state: string; attempts: number; lastError: string | null; updatedAt: string; result: string | null }[]
  'notifications.preferences': null
  'notifications.test': null
  'notifications.markAllRead': null
  'workspaces.create': WorkspaceDto
  'library.pickAndImport': ImportResultDto[]
  'library.importPaths': ImportResultDto[]
  'library.details': MediaDetails
  'library.pending': { id: string; label: string; state: 'queued' | 'running' | 'failed'; error: string | null }[]
  'library.deleteMany': { deleted: string[]; blocked: string[]; failed: string[] }
  'library.delete': null
  'library.setFavorite': null
  'library.frame': { path: string }
  'grid.query': GridPage
  'profiles.refresh': ProfileMetrics
  'profiles.list': ProfileDto[]
  'storage.get': { path: string; custom: boolean }
  'storage.choose': { path: string; custom: boolean } | null
  'storage.reset': { path: string; custom: boolean }
  'profiles.downloadStatus': { configured: boolean }
  'profiles.download': JobView
  'profiles.discover': JobView
  'profiles.downloadSelected': JobView[]
  'profiles.prepareSelected': string[]
  'accounts.instagram': { id: string; username: string; revision: string; validatedAt: string } | null
  'accounts.instagramList': { id: string; username: string; revision: string; validatedAt: string }[]
  'accounts.setDefault': { id: string; username: string; revision: string; validatedAt: string }
  'scheduler.windows.get': { windows: PeakWindow[]; timeZone: string }
  'scheduler.windows.save': { windows: PeakWindow[]; timeZone: string }
  'agenda.range': AgendaResult
  'containers.window.get': ContainerWindowView
  'containers.window.adjust': ContainerWindowView
  'containers.drag.preview': DragPreview & { revision: number }
  'containers.drag.apply': ContainerWindowView
  'containers.distribution.plan': DistributionPlan
  'containers.distribution.apply': DistributionPlan
  'quota.get': QuotaProjection
  'quota.refresh': QuotaProjection
  'compose.scheduleInstagram': JobView[]
  'accounts.verifyInstagram': { id: string; username: string; revision: string; validatedAt: string }
  'accounts.connectInstagram': { id: string; username: string; revision: string; validatedAt: string }
  'accounts.disconnectInstagram': null
  'profiles.scheduleInstagram': JobView[]
  'profiles.archive': null
  'profiles.archived': ProfileDto[]
  'profiles.add': ProfileDto
  'profiles.addReel': { id: string; permalink: string }
  'profiles.importMetricsFile': { upserted: number; rows: { line: number; permalink?: string; error?: string }[] } | null
  'remote.setFavorite': null
  'covers.list': CoverDto[]
  'covers.createImage': CoverDto | null
  'covers.createFrameText': CoverDto
  'versions.saveCover': { versionId: string }
  'versions.requestBanner': JobView
  'versions.prepareVideo': { versionId: string; job: JobView }
  'versions.planVideo': { versionId: string }
  'export.tiktok': JobView
  'export.openFolder': null
  'jobs.list': JobView[]
  'jobs.query': QueuePageResult
  'jobs.health': { paused: boolean; workerId: string; alive: boolean; healthy: boolean; heartbeat: string | null; busy: boolean; running: number; capacity: number; completedLastMinute: number; oldestWaitMs: number; waitingOver10Min: number; stalled: number; attention: number; networkLatencyMs: number | null }
  'jobs.bulk': { changed: string[]; skipped: { id: string; reason: string }[] }
  'jobs.pause': null
  'jobs.tail': { runAt: string; ahead: number }
  'jobs.reschedule': boolean
  'jobs.details': { id?: string; state?: JobState; type?: JobType; createdAt?: string; updatedAt?: string; context?: QueueContext; logs?: DiagnosticEvent[]; attempts: { startedAt: string; finishedAt: string | null; outcome: string | null; errorCode?: string | null; errorMessage: string | null }[]; attemptTotal: number; batchId: string | null; account: string | null; checkpoint: string | null; confirmedPublished?: boolean; publishedVideo?: { assetId: string | null; name: string } | null; label: string; runAt: string; error: string | null; files: { id: string; name: string; filePath: string; thumbnailPath: string | null }[]; originUrl: string | null; folders: string[] }
  'library.saveCopy': { saved: boolean }
  'library.openAsset': null
  'updates.status': UpdateStatus
  'updates.check': UpdateStatus
  'updates.download': UpdateStatus
  'updates.install': null
  'jobs.cancel': boolean
  'jobs.retry': boolean
  'notifications.list': NotificationDto[]
  'notifications.markRead': null
  'settings.get': string | null
  'settings.set': null
  'onboarding.status': OnboardingStepDto[]
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: AppErrorCode; message: string } }
export const EVENTS = { jobsChanged: 'jobs.changed', navigate: 'app.navigate', visibility: 'app.visibility' } as const

import { z } from 'zod'
import type { AchievementSummary } from './achievements'
import type { AppErrorCode } from './errors'
import type { GridPage, JobView, DashboardSummary, IntegrationStatus } from './types'

const ws = z.uuid()
export interface UpdateStatus { state: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error' | 'unsupported'; version: string | null; progress: number; message: string }
const id = z.string().min(1).max(64)
const png = z.instanceof(Uint8Array).refine((b) => b.byteLength <= 20 * 1024 * 1024, 'Imagem acima de 20 MB.')
const coverText = z.object({
  text: z.string().max(120), position: z.enum(['top', 'center', 'bottom']),
  fontSizePct: z.number().min(2).max(20), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).nullable()
})

export const contract = {
  'app.bootstrap': z.object({}),
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
  'library.delete': z.object({ workspaceId: ws, id }),
  'library.setFavorite': z.object({ workspaceId: ws, id, favorite: z.boolean() }),
  'library.frame': z.object({ workspaceId: ws, assetId: id, atMs: z.number().int().min(0) }),
  'grid.query': z.object({
    workspaceId: ws, source: z.enum(['library', 'remote']), profileId: id.optional(),
    sortBy: z.enum(['views', 'likes', 'comments', 'postedAt', 'importedAt', 'durationMs']), sortDir: z.enum(['asc', 'desc']),
    text: z.string().max(100).optional(), hashtag: z.string().max(100).optional(),
    from: z.iso.datetime().optional(), to: z.iso.datetime().optional(),
    maxDurationMs: z.number().int().positive().optional(), minViews: z.number().int().min(0).optional(),
    minLikes: z.number().int().min(0).optional(), minComments: z.number().int().min(0).optional(),
    favoritesOnly: z.boolean().optional(), mediaKind: z.enum(['all', 'videos', 'images']).optional(), limit: z.number().int().min(1).max(200), offset: z.number().int().min(0)
  }),
  'profiles.list': z.object({ workspaceId: ws }),
  'storage.get': z.object({ workspaceId: ws }),
  'storage.choose': z.object({ workspaceId: ws }),
  'storage.reset': z.object({ workspaceId: ws }),
  'profiles.downloadStatus': z.object({ workspaceId: ws }),
  'profiles.download': z.object({ workspaceId: ws, profileId: id, limit: z.number().int().min(1).max(100) }),
  'profiles.discover': z.object({ workspaceId: ws, profileId: id, limit: z.number().int().min(1).max(1000) }),
  'profiles.downloadSelected': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100) }),
  'profiles.prepareSelected': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100) }),
  'accounts.instagram': z.object({ workspaceId: ws }),
  'accounts.verifyInstagram': z.object({ workspaceId: ws }),
  'accounts.connectInstagram': z.object({ workspaceId: ws, token: z.string().trim().min(20).max(4096).regex(/^[A-Za-z0-9_.-]+$/) }),
  'accounts.disconnectInstagram': z.object({ workspaceId: ws }),
  'profiles.scheduleInstagram': z.object({ workspaceId: ws, postIds: z.array(id).min(1).max(100), firstAt: z.iso.datetime(), intervalMin: z.number().int().min(15).max(10080), caption: z.string().max(2200).optional(), cleanupAfterPublish: z.boolean().default(false) }),
  'profiles.add': z.object({ workspaceId: ws, url: z.string().min(1).max(300) }),
  'profiles.addReel': z.object({ workspaceId: ws, profileId: id, url: z.string().min(1).max(300) }),
  'profiles.importMetricsFile': z.object({ workspaceId: ws, profileId: id }),
  'remote.setFavorite': z.object({ workspaceId: ws, id, favorite: z.boolean() }),
  'covers.list': z.object({ workspaceId: ws }),
  'covers.createImage': z.object({ workspaceId: ws, name: z.string().max(80) }),
  'covers.createFrameText': z.object({ workspaceId: ws, name: z.string().max(80), frameMs: z.number().int().min(0), text: coverText }),
  'versions.saveCover': z.object({ workspaceId: ws, assetId: id, templateId: id, png }),
  'versions.requestBanner': z.object({ workspaceId: ws, assetId: id, png, startMs: z.number().int().min(0), endMs: z.number().int().positive() }),
  'export.tiktok': z.object({
    workspaceId: ws, assetIds: z.array(id).min(1).max(100), captions: z.record(z.string(), z.string().max(4000)),
    stripMetadata: z.boolean(), remindAt: z.array(z.iso.datetime().nullable())
  }).refine((v) => v.remindAt.length === v.assetIds.length, { message: 'Lembretes e vídeos não conferem.', path: ['remindAt'] }),
  'export.openFolder': z.object({ workspaceId: ws, path: z.string().min(1) }),
  'jobs.list': z.object({ workspaceId: ws }),
  'jobs.details': z.object({ workspaceId: ws, id }),
  'library.openAsset': z.object({ workspaceId: ws, id }),
  'updates.status': z.object({}),
  'updates.check': z.object({}),
  'updates.download': z.object({}),
  'updates.install': z.object({}),
  'jobs.cancel': z.object({ workspaceId: ws, id }),
  'jobs.retry': z.object({ workspaceId: ws, id }),
  'notifications.list': z.object({ workspaceId: ws }),
  'notifications.markRead': z.object({ workspaceId: ws, id }),
  'settings.get': z.object({ workspaceId: ws, key: z.enum(['minimizeToTray', 'stripMetadataDefault']) }),
  'settings.set': z.object({ workspaceId: ws, key: z.enum(['minimizeToTray', 'stripMetadataDefault']), value: z.enum(['true', 'false']) }),
  'onboarding.status': z.object({ workspaceId: ws })
} as const

export type Channel = keyof typeof contract
export type Input<C extends Channel> = z.infer<(typeof contract)[C]>

export interface WorkspaceDto { id: string; name: string; timeZone: string }
export interface ImportResultDto { path: string; status: 'imported' | 'duplicate' | 'rejected'; assetId?: string; errors: string[]; warnings: string[] }
export interface ProfileDto { id: string; username: string; url: string; connected: boolean; lastSyncedAt: string | null }
export interface CoverDto { id: string; name: string; kind: 'image' | 'frame_text'; imagePath: string | null; frameMs: number | null; textJson: string | null }
export interface NotificationDto { id: string; kind: 'info' | 'error' | 'manual_task'; title: string; body: string; actionJson: string | null; dueAt: string | null; readAt: string | null; createdAt: string }
export interface OnboardingStepDto { key: string; label: string; done: boolean; disabledReason?: string }

export interface Outputs {
  'app.bootstrap': { workspaces: WorkspaceDto[]; version: string; workerAlive: boolean; dataDir: string }
  'dashboard.get': DashboardSummary
  'achievements.get': AchievementSummary & { acknowledged: string[] }
  'achievements.acknowledge': null
  'publications.history': { jobId: string; accountId: string; username: string; postId: string; assetSha: string | null; mediaId: string | null; provenanceJson: string; publishedAt: string; cleanupState: string }[]
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
  'library.delete': null
  'library.setFavorite': null
  'library.frame': { path: string }
  'grid.query': GridPage
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
  'accounts.verifyInstagram': { id: string; username: string; revision: string; validatedAt: string }
  'accounts.connectInstagram': { id: string; username: string; revision: string; validatedAt: string }
  'accounts.disconnectInstagram': null
  'profiles.scheduleInstagram': JobView[]
  'profiles.add': ProfileDto
  'profiles.addReel': { id: string; permalink: string }
  'profiles.importMetricsFile': { upserted: number; rows: { line: number; permalink?: string; error?: string }[] } | null
  'remote.setFavorite': null
  'covers.list': CoverDto[]
  'covers.createImage': CoverDto | null
  'covers.createFrameText': CoverDto
  'versions.saveCover': { versionId: string }
  'versions.requestBanner': JobView
  'export.tiktok': JobView
  'export.openFolder': null
  'jobs.list': JobView[]
  'jobs.details': { label: string; runAt: string; error: string | null; files: { id: string; name: string; filePath: string; thumbnailPath: string | null }[]; originUrl: string | null; folders: string[] }
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
export const EVENTS = { jobsChanged: 'jobs.changed', navigate: 'app.navigate' } as const

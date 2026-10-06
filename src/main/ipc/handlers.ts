import { repostWarnings } from '../services/repost-check'
import { deleteNotifications } from '../repos/notifications'
import { mediaDetails, pendingMedia, deleteMany } from '../services/media-manager'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { and, desc, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { Handlers } from './dispatcher'
import type { Ctx } from '../context'
import { listWorkspaces, createWorkspace } from '../repos/workspaces'
import { getSetting, setSetting } from '../repos/settings'
import { importFiles, deleteAsset, storedAssetDir } from '../services/library'
import { getAsset, setAssetFavorite } from '../repos/assets'
import { extractFrame } from '../media/ops'
import { queryGrid } from '../services/grid'
import { addProfileFromUrl, listProfiles, type Profile } from '../repos/profiles'
import { addReelLink, setRemoteFavorite } from '../repos/remote-posts'
import { importMetrics } from '../services/metrics-import'
import { createImageCover, createFrameTextCover, listCoverTemplates, type CoverTemplate } from '../repos/covers'
import { saveRenderedCover, requestBanner, requestVideoVersion } from '../services/versions'
import { requestTiktokExport } from '../services/export-tiktok'
import { workspaceDir, resolveInside } from '../paths'
import { listJobs, cancel, retryNow, queryJobs, tailSlot, reschedule } from '../queue/queue'
import { listNotifications, markRead, markAllRead, addNotification } from '../repos/notifications'
import { onboardingStatus } from '../services/onboarding'
import { downloadConfigured, requestProfileDownload, requestSelectedDownloads, selectedAssets } from '../services/profile-download'
import { videoStorage, setVideoStorage } from '../services/storage'
import { dashboard } from '../services/dashboard'
import { integrationStatus, requireWorkspace, saveSecret, saveWebhook, validateApify, type SecretVault } from '../services/integrations'
import { enqueueWebhook } from '../services/webhooks'
import { jobs } from '../db/schema'
import { topCaptions } from '../services/captions'
import { jobDetails } from '../services/job-details'
import { instagramAccount, connectInstagram, disconnectInstagram, scheduleInstagram, scheduleComposition, verifyInstagram } from '../services/instagram-publishing'
import type { UpdateStatus } from '@shared/ipc-contract'
import { achievements } from '../services/achievements'
import { history, publicationFeedback, acknowledgePublications } from '../services/publication-history'
import { createGuestSession } from '../services/guest-session'
import { profileImportProgress } from '../services/profile-download'

export interface Dialogs { pickVideos(): Promise<string[]>; pickImage(): Promise<string | null>; pickMetricsFile(): Promise<string | null>; saveVideo?(name: string): Promise<string | null>; pickStorageFolder?(): Promise<string | null> }
export interface HandlerDeps { session?: ReturnType<typeof createGuestSession>; ctx: Ctx; dialogs: Dialogs; shell: { openPath(p: string): Promise<string> }; workerAlive(): boolean; version: string; onJobsChanged(workspaceId: string): void; vault?: SecretVault; onSecretsChanged?(): void; updates?: { status(): UpdateStatus; check(): Promise<UpdateStatus>; download(): Promise<UpdateStatus>; install(): void } }

const profileDto = (p: Profile, avatarPath: string | null = null) => ({ avatarPath, platform: p.platform, id: p.id, username: p.username, url: p.url, connected: p.connectedAccountId !== null, lastSyncedAt: p.lastSyncedAt })
const coverDto = (c: CoverTemplate) => ({ id: c.id, name: c.name, kind: c.kind, imagePath: c.imagePath, frameMs: c.frameMs, textJson: c.textJson })

export function buildHandlers(deps: HandlerDeps): Handlers {
  const { ctx } = deps
  const session = deps.session ?? createGuestSession(() => {})
  const vault = deps.vault ?? { available: () => false, encrypt: () => { throw new Error('Unavailable') }, decrypt: () => { throw new Error('Unavailable') } }
  const now = () => ctx.clock()
  const changed = <T>(workspaceId: string, v: T): T => { deps.onJobsChanged(workspaceId); return v }
  return {
    'publications.checkRepost': i => repostWarnings(ctx, i.workspaceId, i.accountId, i),
    'notifications.delete': i => { requireWorkspace(ctx, i.workspaceId); return changed(i.workspaceId, { deleted: deleteNotifications(ctx.db, i.workspaceId, i) }) },
    'session.get': () => session.get(),
    'session.enterGuest': () => session.enter(),
    'session.exit': () => session.exit(),
    'profiles.importProgress': i => { requireWorkspace(ctx, i.workspaceId); return profileImportProgress(ctx, i.workspaceId, i.profileId) },
    'publications.feedback': i => { requireWorkspace(ctx, i.workspaceId); return publicationFeedback(ctx, i.workspaceId) },
    'publications.acknowledge': i => { requireWorkspace(ctx, i.workspaceId); acknowledgePublications(ctx, i.workspaceId, i.ids); return null },
    'app.bootstrap': () => ({ workspaces: listWorkspaces(ctx.db).map(({ id, name, timeZone }) => ({ id, name, timeZone })), version: deps.version, workerAlive: deps.workerAlive(), dataDir: ctx.dataRoot }),
    'dashboard.get': (i) => dashboard(ctx, i.workspaceId),
    'achievements.get': (i) => ({ ...achievements(ctx, i.workspaceId), acknowledged: JSON.parse(getSetting(ctx.db, i.workspaceId, 'acknowledgedAchievements') ?? '[]') }),
    'achievements.acknowledge': (i) => { const unlocked = achievements(ctx, i.workspaceId).challenges.filter(c => c.unlocked).map(c => c.id); const old = JSON.parse(getSetting(ctx.db, i.workspaceId, 'acknowledgedAchievements') ?? '[]') as string[]; setSetting(ctx.db, i.workspaceId, 'acknowledgedAchievements', JSON.stringify([...new Set([...old, ...i.ids.filter(id => unlocked.includes(id))])])); return null },
    'publications.history': (i) => { requireWorkspace(ctx, i.workspaceId); return history(ctx, i.workspaceId) },
    'captions.top': (i) => topCaptions(ctx, i.workspaceId, i.sortBy, i.profileId),
    'tutorial.planGet': (i) => { requireWorkspace(ctx, i.workspaceId); const plan = getSetting(ctx.db, i.workspaceId, 'profilePlan'); return plan ? JSON.parse(plan) : null },
    'tutorial.planSave': ({ workspaceId, ...plan }) => { requireWorkspace(ctx, workspaceId); setSetting(ctx.db, workspaceId, 'profilePlan', JSON.stringify(plan)); return null },
    'integrations.get': (i) => integrationStatus(ctx, i.workspaceId, vault.available()),
    'integrations.saveApify': (i) => { saveSecret(ctx, vault, i.workspaceId, 'apifyToken', i.token); setSetting(ctx.db, i.workspaceId, 'apifyValidatedAt', ''); deps.onSecretsChanged?.(); return null },
    'integrations.removeApify': (i) => { saveSecret(ctx, vault, i.workspaceId, 'apifyToken', ''); setSetting(ctx.db, i.workspaceId, 'apifyValidatedAt', ''); deps.onSecretsChanged?.(); return null },
    'integrations.testApify': (i) => validateApify(ctx, i.workspaceId),
    'webhooks.save': (i) => { saveWebhook(ctx, vault, i.workspaceId, i); deps.onSecretsChanged?.(); return null },
    'webhooks.test': (i) => {
      requireWorkspace(ctx, i.workspaceId)
      const job = enqueueWebhook(ctx, i.workspaceId, 'webhook.test')
      if (!job) throw new AppError('invalid_input', 'Salve e ative o webhook antes de enviar um evento de teste.')
      return changed(i.workspaceId, job)
    },
    'webhooks.list': (i) => ctx.db.select({ id: jobs.id, state: jobs.state, attempts: jobs.attempts, lastError: jobs.lastError, updatedAt: jobs.updatedAt, result: jobs.resultJson }).from(jobs).where(and(eq(jobs.workspaceId, i.workspaceId), eq(jobs.type, 'webhook_delivery'))).orderBy(desc(jobs.createdAt)).limit(20).all(),
    'notifications.preferences': ({ workspaceId, ...preferences }) => { requireWorkspace(ctx, workspaceId); setSetting(ctx.db, workspaceId, 'notificationPreferences', JSON.stringify(preferences)); return null },
    'notifications.test': (i) => { requireWorkspace(ctx, i.workspaceId); addNotification(ctx.db, { workspaceId: i.workspaceId, kind: 'info', title: 'Notificações do Legacy', body: 'Esta é uma notificação de teste. O alerta do Windows depende das permissões do sistema e pode levar até 30 segundos.' }, now()); return changed(i.workspaceId, null) },
    'notifications.markAllRead': (i) => { markAllRead(ctx.db, i.workspaceId, now()); return null },
    'workspaces.create': (i) => { const w = createWorkspace(ctx.db, i); publicationFeedback(ctx, w.id); return { id: w.id, name: w.name, timeZone: w.timeZone } },
    'library.pickAndImport': async (i) => {
      const paths = await deps.dialogs.pickVideos()
      return paths.length ? changed(i.workspaceId, await importFiles(ctx, i.workspaceId, paths)) : []
    },
    'library.importPaths': async (i) => changed(i.workspaceId, await importFiles(ctx, i.workspaceId, i.paths)),
    'library.details': i => mediaDetails(ctx, i.workspaceId, i.id, i.offset),
    'library.pending': i => pendingMedia(ctx, i.workspaceId),
    'library.deleteMany': async i => changed(i.workspaceId, await deleteMany(ctx, i.workspaceId, i.ids)),
    'library.delete': async i => { const r = await deleteMany(ctx, i.workspaceId, [i.id]); if (r.blocked.length) throw new AppError('invalid_input', 'Vídeo em uso por uma tarefa ativa. Cancele a tarefa antes de excluir.'); if (r.failed.length) throw new AppError('invalid_input', 'Não foi possível excluir o vídeo.'); return changed(i.workspaceId, null) },
    'library.setFavorite': (i) => { setAssetFavorite(ctx.db, i.workspaceId, i.id, i.favorite); return null },
    'library.frame': async (i) => {
      const a = getAsset(ctx.db, i.workspaceId, i.assetId)
      if (!a) throw new AppError('not_found', 'Vídeo não encontrado.')
      const at = Math.min(i.atMs, Math.max(0, a.durationMs - 100))
      const out = join(storedAssetDir(ctx, i.workspaceId, i.assetId), 'frames', `${at}.png`)
      await mkdir(dirname(out), { recursive: true })
      await extractFrame(a.filePath, at, out)
      return { path: out }
    },
    'grid.query': (i) => queryGrid(ctx.db, i),
    'profiles.list': (i) => listProfiles(ctx.db, i.workspaceId).map(p => profileDto(p, getSetting(ctx.db, i.workspaceId, `profileAvatar.${p.id}`))),
    'profiles.downloadStatus': (i) => ({ configured: downloadConfigured(ctx, i.workspaceId) }),
    'profiles.download': (i) => changed(i.workspaceId, requestProfileDownload(ctx, i.workspaceId, i.profileId, i.limit)),
    'profiles.discover': (i) => changed(i.workspaceId, requestProfileDownload(ctx, i.workspaceId, i.profileId, i.limit, true)),
    'profiles.downloadSelected': (i) => changed(i.workspaceId, requestSelectedDownloads(ctx, i.workspaceId, i.postIds)),
    'profiles.prepareSelected': (i) => selectedAssets(ctx, i.workspaceId, i.postIds),
    'accounts.instagram': (i) => instagramAccount(ctx, i.workspaceId),
    'accounts.verifyInstagram': async (i) => { const account = await verifyInstagram(ctx, vault, i.workspaceId); deps.onSecretsChanged?.(); return account },
    'accounts.connectInstagram': async (i) => { const account = await connectInstagram(ctx, vault, i.workspaceId, i.token); deps.onSecretsChanged?.(); return account },
    'compose.scheduleInstagram': (i) => changed(i.workspaceId,scheduleComposition(ctx,i.workspaceId,i)),
    'accounts.disconnectInstagram': (i) => { disconnectInstagram(ctx, vault, i.workspaceId); deps.onSecretsChanged?.(); return null },
    'profiles.scheduleInstagram': (i) => changed(i.workspaceId, scheduleInstagram(ctx, i.workspaceId, i)),
    'profiles.add': (i) => changed(i.workspaceId, profileDto(addProfileFromUrl(ctx, i.workspaceId, i.url))),
    'profiles.addReel': (i) => { const r = addReelLink(ctx, i.workspaceId, i.profileId, i.url); return changed(i.workspaceId, { id: r.id, permalink: r.permalink }) },
    'profiles.importMetricsFile': async (i) => {
      const file = await deps.dialogs.pickMetricsFile()
      if (!file) return null
      const format = extname(file).toLowerCase() === '.json' ? 'json' : 'csv'
      return changed(i.workspaceId, importMetrics(ctx, i.workspaceId, i.profileId, await readFile(file, 'utf8'), format))
    },
    'remote.setFavorite': (i) => { setRemoteFavorite(ctx.db, i.workspaceId, i.id, i.favorite); return null },
    'covers.list': (i) => listCoverTemplates(ctx.db, i.workspaceId).map(coverDto),
    'covers.createImage': async (i) => {
      const file = await deps.dialogs.pickImage()
      return file ? coverDto(await createImageCover(ctx, i.workspaceId, { name: i.name, imagePath: file })) : null
    },
    'covers.createFrameText': (i) => coverDto(createFrameTextCover(ctx, i.workspaceId, i)),
    'versions.saveCover': async (i) => ({ versionId: (await saveRenderedCover(ctx, i.workspaceId, i.assetId, i.templateId, i.png)).id }),
    'versions.requestBanner': async (i) => changed(i.workspaceId, await requestBanner(ctx, i.workspaceId, i.assetId, i.png, { startMs: i.startMs, endMs: i.endMs })),
    'versions.prepareVideo': async (i) => { const r = await requestVideoVersion(ctx, i.workspaceId, i.assetId, { banner: i.banner, coverVersionId: i.coverVersionId }); changed(i.workspaceId, r.job); return r },
    'export.tiktok': ({ workspaceId, ...payload }) => changed(workspaceId, requestTiktokExport(ctx, workspaceId, payload)),
    'export.openFolder': async (i) => {
      const safe = resolveInside(resolveInside(workspaceDir(ctx.dataRoot, i.workspaceId), 'exports'), i.path)
      const isDir = await stat(safe).then((s) => s.isDirectory(), () => false)
      if (!isDir) throw new AppError('invalid_input', 'Só é possível abrir pastas de exportação.')
      const err = await deps.shell.openPath(safe)
      if (err) throw new AppError('not_found', 'Não foi possível abrir a pasta.')
      return null
    },
    'jobs.list': (i) => listJobs(ctx.db, i.workspaceId),
    'jobs.query': (i) => queryJobs(ctx.db, i),
    'jobs.tail': (i) => tailSlot(ctx.db, i.workspaceId, i.id, now()),
    'jobs.reschedule': (i) => changed(i.workspaceId, reschedule(ctx.db, i.workspaceId, i.id, i.runAt, i.expectedUpdatedAt, now())),
    'jobs.details': (i) => jobDetails(ctx, i.workspaceId, i.id),
    'library.saveCopy': async i => { const asset = getAsset(ctx.db, i.workspaceId, i.id); if (!asset) throw new AppError('not_found', 'Vídeo não encontrado.'); const destination = await deps.dialogs.saveVideo?.(basename(asset.sourceName)); if (!destination) return { saved: false }; if (resolve(destination) !== resolve(asset.filePath)) await copyFile(asset.filePath, destination); return { saved: true } },
    'library.openAsset': async (i) => { const a = getAsset(ctx.db, i.workspaceId, i.id); if (!a) throw new AppError('not_found', 'Vídeo não encontrado.'); const error = await deps.shell.openPath(a.filePath); if (error) throw new AppError('internal', 'Não foi possível abrir o arquivo.'); return null },
    'updates.status': () => deps.updates?.status() ?? { state: 'unsupported', version: null, progress: 0, message: 'Atualizador indisponível.' },
    'updates.check': () => { if (!deps.updates) throw new AppError('invalid_input', 'Atualizador indisponível.'); return deps.updates.check() },
    'updates.download': () => { if (!deps.updates) throw new AppError('invalid_input', 'Atualizador indisponível.'); return deps.updates.download() },
    'updates.install': () => { if (!deps.updates) throw new AppError('invalid_input', 'Atualizador indisponível.'); deps.updates.install(); return null },
    'jobs.cancel': (i) => changed(i.workspaceId, cancel(ctx.db, i.workspaceId, i.id, now())),
    'jobs.retry': (i) => changed(i.workspaceId, retryNow(ctx.db, i.workspaceId, i.id, now())),
    'notifications.list': (i) => listNotifications(ctx.db, i.workspaceId, ctx.clock()),
    'notifications.markRead': (i) => { markRead(ctx.db, i.workspaceId, i.id, now()); return null },
    'settings.get': (i) => getSetting(ctx.db, i.workspaceId, i.key),
    'storage.get': (i) => videoStorage(ctx, i.workspaceId),
    'storage.choose': async (i) => {
      const path = await deps.dialogs.pickStorageFolder?.()
      return path ? setVideoStorage(ctx, i.workspaceId, path) : null
    },
    'storage.reset': (i) => setVideoStorage(ctx, i.workspaceId, null),
    'settings.set': (i) => { setSetting(ctx.db, i.workspaceId, i.key, i.value); return null },
    'onboarding.status': (i) => onboardingStatus(ctx.db, i.workspaceId)
  }
}

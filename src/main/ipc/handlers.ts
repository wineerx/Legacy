import { diagnosticEvents, workerHeartbeat, sanitizeDiagnostic } from '../diagnostics'
import { refreshProfile, profileMetrics } from '../services/profile-refresh'
import { profileContentSource } from '@shared/ipc-contract'
import { repostWarnings } from '../services/repost-check'
import { deleteNotifications } from '../repos/notifications'
import { mediaDetails, pendingMedia, deleteMany } from '../services/media-manager'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { and, desc, eq, count, gt } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { Handlers } from './dispatcher'
import type { Ctx } from '../context'
import { listWorkspaces, createWorkspace } from '../repos/workspaces'
import { getSetting, setSetting } from '../repos/settings'
import { importFiles, deleteAsset, storedAssetDir } from '../services/library'
import { getAsset, setAssetFavorite } from '../repos/assets'
import { extractFrame } from '../media/ops'
import { queryGrid } from '../services/grid'
import { addProfileFromUrl, archiveProfile, listProfiles, type Profile } from '../repos/profiles'
import { addReelLink, setRemoteFavorite } from '../repos/remote-posts'
import { importMetrics } from '../services/metrics-import'
import { createImageCover, createFrameTextCover, listCoverTemplates, type CoverTemplate } from '../repos/covers'
import { saveRenderedCover, requestBanner, requestVideoVersion, planVideoVersion } from '../services/versions'
import { requestTiktokExport } from '../services/export-tiktok'
import { workspaceDir, resolveInside } from '../paths'
import { listJobs, cancel, retryNow, queryJobs, tailSlot, reschedule, operateJobs } from '../queue/queue'
import { queueHealth } from '../services/queue-monitor'
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
import { instagramAccount, instagramAccounts, connectInstagram, disconnectInstagram, scheduleInstagram, scheduleComposition, verifyInstagram, refreshInstagramQuota, setDefaultInstagramAccount } from '../services/instagram-publishing'
import { accountQuota } from '../services/instagram-quota'
import { readPeakWindows, savePeakWindows, planDistribution, applyDistribution } from '../services/peak-windows'
import { readContainerWindow, applyContainerAdjustment, withEstimate } from '../services/container-window'
import { readAgenda } from '../services/agenda'
import type { UpdateStatus } from '@shared/ipc-contract'
import { achievements } from '../services/achievements'
import { history, publicationFeedback, acknowledgePublications } from '../services/publication-history'
import { createGuestSession } from '../services/guest-session'
import { profileImportProgress } from '../services/profile-download'
import { pipelineSnapshot } from '../services/pipeline-observability'
import { schedulePublicationBatch } from '../services/instagram-publishing'
import { createContainer, updateContainerDraft, readContainer, listContainers, scheduleContainer, setContainerControl, cancelContainer } from '../services/publication-containers'
import { createTemplate, saveTemplateVersion, readTemplate, listTemplates, duplicateTemplate, archiveTemplate, deleteTemplate, applyTemplate } from '../services/visual-templates'
import { visualPreviewOverrides } from '../services/container-visual'

export interface Dialogs { pickVideos(): Promise<string[]>; pickImage(): Promise<string | null>; pickMetricsFile(): Promise<string | null>; saveDiagnostic?(name: string): Promise<string | null>; saveVideo?(name: string): Promise<string | null>; pickStorageFolder?(): Promise<string | null> }
export interface HandlerDeps { session?: ReturnType<typeof createGuestSession>; ctx: Ctx; dialogs: Dialogs; shell: { openPath(p: string): Promise<string> }; workerAlive(): boolean; workerPaused?(): boolean; pauseWorker?(paused: boolean): Promise<void>; version: string; buildCommit?: string; buildTime?: string; onJobsChanged(workspaceId: string): void; vault?: SecretVault; onSecretsChanged?(): void; updates?: { status(): UpdateStatus; check(): Promise<UpdateStatus>; download(): Promise<UpdateStatus>; install(): void } }

const profileDto = (p: Profile, avatarPath: string | null = null) => ({ avatarPath, platform: p.platform, id: p.id, username: p.username, url: p.url, connected: p.connectedAccountId !== null, lastSyncedAt: p.lastSyncedAt })
const coverDto = (c: CoverTemplate) => ({ id: c.id, name: c.name, kind: c.kind, imagePath: c.imagePath, frameMs: c.frameMs, textJson: c.textJson })

export function buildHandlers(deps: HandlerDeps): Handlers {
  const { ctx } = deps
  const session = deps.session ?? createGuestSession(() => {})
  const vault = deps.vault ?? { available: () => false, encrypt: () => { throw new Error('Unavailable') }, decrypt: () => { throw new Error('Unavailable') } }
  const now = () => ctx.clock()
  const requireQuotaAccount = (ws: string, accountId: string) => {
    requireWorkspace(ctx, ws)
    if (!instagramAccounts(ctx, ws).some(a => a.id === accountId) && instagramAccount(ctx, ws, accountId)?.id !== accountId) throw new AppError('not_found', 'Conta não encontrada neste workspace.')
  }
  const changed = <T>(workspaceId: string, v: T): T => { deps.onJobsChanged(workspaceId); return v }
  const destinationsChanged = <T>(workspaceId: string, v: T): T => { deps.onSecretsChanged?.(); return changed(workspaceId,v) }
  return {
    'templates.create': i => createTemplate(ctx,i.workspaceId,i.requestId,i.input),
    'templates.saveVersion': i => saveTemplateVersion(ctx,i.workspaceId,i.templateId,i.expectedRevision,i.requestId,i.input),
    'templates.get': i => readTemplate(ctx,i.workspaceId,i.templateId,i.version),
    'templates.query': i => listTemplates(ctx,i.workspaceId,i),
    'templates.duplicate': i => duplicateTemplate(ctx,i.workspaceId,i.templateId,i.requestId,i.version),
    'templates.archive': i => archiveTemplate(ctx,i.workspaceId,i.templateId,i.expectedRevision,i.archived),
    'templates.delete': i => deleteTemplate(ctx,i.workspaceId,i.templateId,i.expectedRevision),
    'containers.applyTemplate': i => destinationsChanged(i.workspaceId,applyTemplate(ctx,i.workspaceId,i.containerId,i.expectedRevision,i.draft,i.templateId,i.templateVersion)),
    'containers.create': i => destinationsChanged(i.workspaceId,createContainer(ctx,i.workspaceId,i.requestId,i.draft)),
    'containers.updateDraft': i => destinationsChanged(i.workspaceId,updateContainerDraft(ctx,i.workspaceId,i.containerId,i.expectedRevision,i.draft)),
    'containers.get': i => { const d=readContainer(ctx,i.workspaceId,i.containerId,i.page,i.pageSize); return {...d,container:withEstimate(ctx,i.workspaceId,d.container)} },
    'containers.query': i => { const p=listContainers(ctx,i.workspaceId,i); return {...p,items:p.items.map(c=>withEstimate(ctx,i.workspaceId,c))} },
    'agenda.range': i => readAgenda(ctx,i.workspaceId,i),
    'containers.window.get': i => readContainerWindow(ctx,i.workspaceId,i.containerId),
    // Explicit choice only; recomputed and validated atomically before any job moves.
    'containers.window.adjust': i => changed(i.workspaceId,applyContainerAdjustment(ctx,i.workspaceId,i.containerId,i)),
    'containers.schedule': i => changed(i.workspaceId,scheduleContainer(ctx,i.workspaceId,i.containerId,i.expectedRevision)),
    'containers.previewOverrides': i => visualPreviewOverrides(ctx,i.workspaceId,i.assetId,i.recipeVersionId),
    'containers.pause': i => changed(i.workspaceId,setContainerControl(ctx,i.workspaceId,i.containerId,i.expectedRevision,'paused')),
    'containers.resume': i => changed(i.workspaceId,setContainerControl(ctx,i.workspaceId,i.containerId,i.expectedRevision,'active')),
    'containers.cancel': async i => changed(i.workspaceId,await cancelContainer(ctx,i.workspaceId,i.containerId,i.expectedRevision)),
    'diagnostics.pipeline': i => {requireWorkspace(ctx,i.workspaceId);return pipelineSnapshot(ctx,i.workspaceId,deps.workerAlive())},
    'publications.schedule': i => destinationsChanged(i.workspaceId,schedulePublicationBatch(ctx,i.workspaceId,i.batchId,i.items)),
    'diagnostics.queue': i => { requireWorkspace(ctx, i.workspaceId); return sanitizeDiagnostic(queryJobs(ctx.db, { workspaceId: i.workspaceId, page: i.page, pageSize: 100, search: '' })) },
    'diagnostics.export': async i => {
      requireWorkspace(ctx, i.workspaceId)
      const destination = await deps.dialogs.saveDiagnostic?.(`legacy-diagnostics-${now().toISOString().replace(/[:.]/g, '-')}.json`)
      if (!destination) return { saved: false }
      const first = queryJobs(ctx.db, { workspaceId: i.workspaceId, page: 1, pageSize: 100, search: '' })
      const items = [...first.items]
      for (let page = 2; page <= Math.ceil(first.total / 100); page++) items.push(...queryJobs(ctx.db, { workspaceId: i.workspaceId, page, pageSize: 100, search: '' }).items)
      const checkpoints = ctx.db.select({ id: jobs.id, result: jobs.resultJson }).from(jobs).where(and(eq(jobs.workspaceId, i.workspaceId), eq(jobs.state, 'running'))).all().map(j => { const r = JSON.parse(j.result ?? '{}'); return { taskId: j.id, creating: Boolean(r.creating), containerId: r.containerId, publishing: Boolean(r.publishing), mediaId: r.mediaId } })
      await writeFile(destination, JSON.stringify(sanitizeDiagnostic({ version: 1, exportedAt: now().toISOString(), workspaceId: i.workspaceId, retention: 'Últimos 2000 eventos da sessão', events: diagnosticEvents(i.workspaceId), queue: { ...first, items }, checkpoints, worker: { alive: deps.workerAlive(), heartbeat: workerHeartbeat() } }), null, 2), 'utf8')
      return { saved: true }
    },
    'diagnostics.snapshot': i => { requireWorkspace(ctx, i.workspaceId); return { events: diagnosticEvents(i.workspaceId), workerAlive: deps.workerAlive(), heartbeat: workerHeartbeat(), failedJobs: sanitizeDiagnostic(listJobs(ctx.db, i.workspaceId, ['failed'])), retryCount: ctx.db.select({ n: count() }).from(jobs).where(and(eq(jobs.workspaceId, i.workspaceId), eq(jobs.state, 'queued'), gt(jobs.attempts, 0))).get()!.n, stages: Object.fromEntries(ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, i.workspaceId), eq(jobs.state, 'running'))).all().map(j => { const r = JSON.parse(j.resultJson ?? '{}'); return [j.id, r.confirmedPublished || r.mediaId ? 'Confirmed' : r.publishing ? 'Publishing' : r.containerId ? 'Waiting provider' : r.creating ? 'Uploading' : j.type === 'publish_instagram' ? 'Preparing' : 'Processing'] })) } },
    'publications.checkRepost': i => repostWarnings(ctx, i.workspaceId, i.accountId, i),
    'notifications.delete': i => { requireWorkspace(ctx, i.workspaceId); return changed(i.workspaceId, { deleted: deleteNotifications(ctx.db, i.workspaceId, i) }) },
    'session.get': () => session.get(),
    'session.enterGuest': () => session.enter(),
    'session.exit': () => session.exit(),
    'profiles.importProgress': i => { requireWorkspace(ctx, i.workspaceId); return profileImportProgress(ctx, i.workspaceId, i.profileId) },
    'publications.feedback': i => { requireWorkspace(ctx, i.workspaceId); return publicationFeedback(ctx, i.workspaceId) },
    'publications.acknowledge': i => { requireWorkspace(ctx, i.workspaceId); acknowledgePublications(ctx, i.workspaceId, i.ids); return null },
    'app.bootstrap': () => ({ workspaces: listWorkspaces(ctx.db).map(({ id, name, timeZone }) => ({ id, name, timeZone })), version: deps.version, buildCommit: deps.buildCommit, buildTime: deps.buildTime, workerAlive: deps.workerAlive(), dataDir: ctx.dataRoot }),
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
    'profiles.refresh': async (i) => { requireWorkspace(ctx, i.workspaceId); return changed(i.workspaceId, await refreshProfile(ctx, i.workspaceId, i.profileId)) },
    'profiles.list': (i) => listProfiles(ctx.db, i.workspaceId).map(p => ({ metrics: profileMetrics(ctx, i.workspaceId, p.id), ...profileDto(p, getSetting(ctx.db, i.workspaceId, `profileAvatar.${p.id}`)), contentSource: profileContentSource.catch('posts').parse(getSetting(ctx.db, i.workspaceId, `profileContentSource.${p.id}`)) })),
    'profiles.downloadStatus': (i) => ({ configured: downloadConfigured(ctx, i.workspaceId) }),
    'profiles.download': (i) => changed(i.workspaceId, requestProfileDownload(ctx, i.workspaceId, i.profileId, i.limit)),
    'profiles.discover': (i) => changed(i.workspaceId, requestProfileDownload(ctx, i.workspaceId, i.profileId, i.limit, true, i.source)),
    'profiles.downloadSelected': (i) => changed(i.workspaceId, requestSelectedDownloads(ctx, i.workspaceId, i.postIds)),
    'profiles.prepareSelected': (i) => selectedAssets(ctx, i.workspaceId, i.postIds),
    'accounts.instagram': (i) => instagramAccount(ctx, i.workspaceId, i.accountId),
    'accounts.instagramList': (i) => instagramAccounts(ctx,i.workspaceId),
    'accounts.setDefault': (i) => setDefaultInstagramAccount(ctx,i.workspaceId,i.accountId),
    'scheduler.windows.get': (i) => readPeakWindows(ctx,i.workspaceId),
    'scheduler.windows.save': (i) => savePeakWindows(ctx,i.workspaceId,i.windows),
    // Preview only; applying recomputes the plan atomically and touches drafts only.
    'containers.distribution.plan': (i) => planDistribution(ctx,i.workspaceId,i),
    'containers.distribution.apply': (i) => applyDistribution(ctx,i.workspaceId,i),
    // Read-only projection; `slots` are candidate times of a draft that has no jobs yet.
    'quota.get': (i) => { requireQuotaAccount(i.workspaceId,i.accountId); return accountQuota(ctx,i.workspaceId,i.accountId,{candidates:i.slots}) },
    'quota.refresh': async (i) => { requireQuotaAccount(i.workspaceId,i.accountId); await refreshInstagramQuota(ctx,i.workspaceId,i.accountId); return accountQuota(ctx,i.workspaceId,i.accountId,{candidates:i.slots}) },
    'accounts.verifyInstagram': async (i) => { const account = await verifyInstagram(ctx, vault, i.workspaceId, undefined, i.accountId); deps.onSecretsChanged?.(); return account },
    'accounts.connectInstagram': async (i) => { const account = await connectInstagram(ctx, vault, i.workspaceId, i.token); deps.onSecretsChanged?.(); return account },
    'compose.scheduleInstagram': (i) => destinationsChanged(i.workspaceId,scheduleComposition(ctx,i.workspaceId,i)),
    'accounts.disconnectInstagram': (i) => { disconnectInstagram(ctx, vault, i.workspaceId, i.accountId); deps.onSecretsChanged?.(); return null },
    'profiles.scheduleInstagram': (i) => destinationsChanged(i.workspaceId, scheduleInstagram(ctx, i.workspaceId, i)),
    'profiles.archive': (i) => { requireWorkspace(ctx, i.workspaceId); archiveProfile(ctx, i.workspaceId, i.profileId, i.archived); return changed(i.workspaceId, null) },
    'profiles.archived': (i) => { requireWorkspace(ctx, i.workspaceId); return listProfiles(ctx.db, i.workspaceId, true).map(p => profileDto(p)) },
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
    'versions.planVideo': (i) => planVideoVersion(ctx,i.workspaceId,i.assetId,{banner:i.banner,coverVersionId:i.coverVersionId}),
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
    'jobs.query': (i) => sanitizeDiagnostic(queryJobs(ctx.db, i)),
    'jobs.health': i => { requireWorkspace(ctx, i.workspaceId); return { ...queueHealth(ctx.db, i.workspaceId, deps.workerAlive(), now()), paused: deps.workerPaused?.() ?? false } },
    'jobs.pause': async i => { requireWorkspace(ctx, i.workspaceId); if (!deps.pauseWorker) throw new AppError('invalid_input', 'Controle do worker indisponível.'); await deps.pauseWorker(i.paused); return null },
    'jobs.bulk': i => { requireWorkspace(ctx, i.workspaceId); const result = operateJobs(ctx.db, i.workspaceId, i.items, i.action, now(), i.priority); if (result.changed.length) deps.onJobsChanged(i.workspaceId); return result },
    'jobs.tail': (i) => tailSlot(ctx.db, i.workspaceId, i.id, now()),
    'jobs.reschedule': (i) => changed(i.workspaceId, reschedule(ctx.db, i.workspaceId, i.id, i.runAt, i.expectedUpdatedAt, now())),
    'jobs.details': (i) => sanitizeDiagnostic(jobDetails(ctx, i.workspaceId, i.id)),
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

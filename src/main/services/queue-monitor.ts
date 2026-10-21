import { and, eq, desc, count, gte, sql, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { jobs, remotePosts, trackedProfiles, mediaAssets, jobAttempts, publicationHistory, settings, providerLimits } from '../db/schema'
import type { QueueContext } from '@shared/types'
import { getSetting } from '../repos/settings'
import { workerHeartbeat, diagnosticEvents } from '../diagnostics'
import { pipelineConfig } from '../pipeline-config'

export const queuePriority = sql<number>`${jobs.priority}`
export const queueVisible = sql`not exists(select 1 from settings where workspace_id = ${jobs.workspaceId} and key = 'jobHidden.' || ${jobs.id} and value = 'true')`

/** Page-scoped relations: no SQL per card. Also reused for publication labels. */
export function loadQueueRelations(db: Db, rows: (typeof jobs.$inferSelect)[]) {
  const ids = rows.map(r => r.id), workspaces = [...new Set(rows.map(r => r.workspaceId))]
  const key = (ws: string, id: string) => `${ws}:${id}`
  const publications = ids.length ? db.select().from(publicationHistory).where(and(inArray(publicationHistory.jobId, ids), inArray(publicationHistory.workspaceId, workspaces))).all() : []
  const assetIds = new Set<string>(), postIds = new Set<string>(), profileIds = new Set<string>()
  for (const row of rows) {
    const p = JSON.parse(row.payloadJson), r = JSON.parse(row.resultJson ?? '{}')
    for (const id of [p.localAssetId, p.assetId, p.assetIds?.[0], r.assetId]) if (typeof id === 'string') assetIds.add(id)
    if (typeof p.postId === 'string') postIds.add(p.postId)
    if (typeof p.profileId === 'string') profileIds.add(p.profileId)
  }
  for (const pub of publications) {
    if (pub.postId) postIds.add(pub.postId)
    const origin = JSON.parse(pub.provenanceJson)
    if (typeof origin.assetId === 'string') assetIds.add(origin.assetId)
  }
  const posts = (postIds.size || assetIds.size) ? db.select().from(remotePosts).where(and(inArray(remotePosts.workspaceId, workspaces), sql`(${inArray(remotePosts.id, [...postIds])} or ${inArray(remotePosts.assetId, [...assetIds])})`)).all() : []
  for (const post of posts) { if (post.profileId) profileIds.add(post.profileId); if (post.assetId) assetIds.add(post.assetId) }
  const profiles = profileIds.size ? db.select().from(trackedProfiles).where(and(inArray(trackedProfiles.workspaceId, workspaces), inArray(trackedProfiles.id, [...profileIds]))).all() : []
  const assets = assetIds.size ? db.select().from(mediaAssets).where(and(inArray(mediaAssets.workspaceId, workspaces), inArray(mediaAssets.id, [...assetIds]))).all() : []
  const attempts = ids.length ? db.select().from(jobAttempts).where(and(inArray(jobAttempts.jobId, ids), sql`${jobAttempts.id} = (select latest.id from job_attempts latest where latest.job_id = ${jobAttempts.jobId} order by latest.started_at desc, latest.id desc limit 1)`)).all() : []
  const avatars = profiles.length ? db.select().from(settings).where(and(inArray(settings.workspaceId, workspaces), inArray(settings.key, profiles.map(p => `profileAvatar.${p.id}`)))).all() : []
  const limits = workspaces.length ? db.select().from(providerLimits).where(and(inArray(providerLimits.workspaceId, workspaces), eq(providerLimits.provider, 'instagram'), eq(providerLimits.operation, 'publication_quota'))).all() : []
  const postByAsset = new Map<string, typeof remotePosts.$inferSelect>()
  for (const post of posts) if (post.assetId && !postByAsset.has(key(post.workspaceId, post.assetId))) postByAsset.set(key(post.workspaceId, post.assetId), post)
  const errors = new Map<string, ReturnType<typeof diagnosticEvents>[number]>()
  for (const ws of workspaces) for (const event of diagnosticEvents(ws)) if (event.taskId && (event.level === 'ERROR' || (event.statusCode ?? 0) >= 400)) errors.set(key(ws, event.taskId), event)
  return {
    key, publications: new Map(publications.map(p => [key(p.workspaceId, p.jobId!), p])),
    posts: new Map(posts.map(p => [key(p.workspaceId, p.id), p])), postByAsset,
    profiles: new Map(profiles.map(p => [key(p.workspaceId, p.id), p])),
    assets: new Map(assets.map(a => [key(a.workspaceId, a.id), a])),
    attempts: new Map(attempts.map(a => [a.jobId, a])),
    avatars: new Map(avatars.map(a => [key(a.workspaceId, a.key), a.value])), errors,
    publicationLimits: new Map(limits.map(a => [key(a.workspaceId, a.accountId), a.cooldownUntil]))
  }
}

export function queueContext(db: Db, job: typeof jobs.$inferSelect, now: Date, relations = loadQueueRelations(db, [job])): QueueContext {
  const p = JSON.parse(job.payloadJson)
  const r = JSON.parse(job.resultJson ?? '{}')
  const k = (id: string) => relations.key(job.workspaceId, id)
  const published = relations.publications.get(k(job.id))
  const provenance = published ? JSON.parse(published.provenanceJson) : {}
  const assetId = p.localAssetId ?? p.assetId ?? p.assetIds?.[0] ?? r.assetId ?? provenance.assetId
  const post = p.postId || published?.postId
    ? relations.posts.get(k(p.postId ?? published!.postId!))
    : assetId ? relations.postByAsset.get(k(assetId)) : undefined
  const profileId = p.profileId ?? post?.profileId
  const profile = profileId ? relations.profiles.get(k(profileId)) : undefined
  const asset = assetId || post?.assetId ? relations.assets.get(k(assetId ?? post!.assetId!)) : undefined
  const attempt = relations.attempts.get(job.id)
  const stalled = job.state === 'running' && !!job.leaseUntil && job.leaseUntil < now.toISOString()
  const errorEvent = relations.errors.get(k(job.id))
  let stage = job.state === 'done' ? 'Concluída' : job.state === 'failed' ? 'Falhou' : job.state === 'cancelled' ? 'Cancelada' : job.state === 'queued' ? job.lastError && job.attempts > 0 ? 'Retry agendado' : job.runAt > now.toISOString() ? 'Agendada' : 'Na fila' : job.type === 'download_reel' ? 'Baixando' : job.type === 'fetch_profile' ? 'Buscando perfil' : 'Processando'
  let step: number | null = null
  let steps: number | null = null
  if (job.type === 'publish_instagram' && (job.state === 'running' || (job.state === 'queued' && (r.containerId || r.creating)) || (job.state === 'done' && (published || r.mediaId || r.confirmedPublished)))) {
    steps = 5
    step = published || r.mediaId || r.confirmedPublished ? 5 : r.publishing ? 4 : r.containerId ? 3 : r.creating ? 2 : 1
    stage = ['Preparando', 'Enviando mídia', 'Aguardando provider', 'Confirmando publicação', 'Publicação confirmada'][step - 1]
  }
  if (stalled) stage = 'Travada'
  const accountLimit = relations.publicationLimits.get(k(p.accountId))
  const limitedUntil = job.type === 'publish_instagram' && job.state === 'queued'
    ? accountLimit && accountLimit > now.toISOString() ? new Date(Math.max(Date.parse(accountLimit), Date.parse(job.runAt))).toISOString()
      : r.publicationLimit && job.runAt > now.toISOString() ? job.runAt : null
    : null
  if (limitedUntil) stage = 'Conta limitada'
  return {
    assetId: asset?.id ?? null,
    mediaId: asset?.id ?? post?.id ?? null,
    mediaName: post?.caption || asset?.sourceName || provenance.caption || provenance.sourceName || (p.assetIds?.length ? `${p.assetIds.length} vídeos` : null),
    thumbnailPath: asset?.thumbnailPath ?? post?.thumbnailPath ?? null,
    source: profile ? `@${profile.username}` : provenance.profile ? `@${provenance.profile}` : asset ? 'Arquivo local' : null,
    sourceProfileId: profile?.id ?? null, sourceUrl: post?.permalink ?? profile?.url ?? null,
    sourcePlatform: profile?.platform ?? (asset ? 'local' : null),
    destination: typeof p.username === 'string' ? p.username : job.type === 'export_tiktok' ? 'Exportação manual' : null,
    platform: job.type === 'publish_instagram' ? 'instagram' : job.type === 'export_tiktok' ? 'tiktok' : job.type === 'webhook_delivery' ? 'webhook' : profile?.platform ?? 'local',
    workerId: job.state === 'running' ? 'worker-local-01' : null,
    priority: job.priority, stage, step, steps, stalled, publicationLimitUntil: limitedUntil,
    publicationLimitCause: limitedUntil ? r.publicationLimit?.cause ?? 'meta_refusal' : null,
    publicationLimitCheckedAt: limitedUntil ? r.publicationLimit?.checkedAt ?? null : null,
    publicationLimitReading: limitedUntil && r.publicationLimit?.total ? { usage: r.publicationLimit.usage, total: r.publicationLimit.total, windowSec: r.publicationLimit.windowSec } : null,
    needsAttention: job.state === 'failed' || stalled,
    retryAt: job.state === 'queued' && job.attempts > 0 && !!job.lastError ? job.runAt : null,
    lastAttemptAt: attempt?.startedAt ?? null, leaseUntil: job.leaseUntil, errorCode: attempt?.errorCode ?? null,
    sourceAvatarPath: profile ? relations.avatars.get(k(`profileAvatar.${profile.id}`)) ?? null : null,
    errorProvider: errorEvent?.provider ?? null, errorStatus: errorEvent?.statusCode ?? null
  }
}

export function queueHealth(db: Db, workspaceId: string, alive: boolean, now: Date) {
  const iso = now.toISOString()
  const running = db.select({ n: count() }).from(jobs).where(eq(jobs.state, 'running')).get()!.n
  const rows = db.select({ id: jobs.id, state: jobs.state, runAt: jobs.runAt, lease: jobs.leaseUntil }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), queueVisible, sql`${jobs.state} in ('running','queued','failed')`)).all()
  const completedLastMinute = db.select({ n: count() }).from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.state, 'done'), gte(jobs.updatedAt, new Date(now.getTime() - 60_000).toISOString()))).get()!.n
  const overdue = rows.filter(r => r.state === 'queued' && r.runAt < iso)
  const waitMs = overdue.length ? Math.max(0, now.getTime() - Math.min(...overdue.map(r => Date.parse(r.runAt)))) : 0
  const heartbeat = workerHeartbeat()
  const healthy = alive && !!heartbeat && now.getTime() - Date.parse(heartbeat) < 10_000
  const network = diagnosticEvents(workspaceId).filter(e => e.source === 'network' && e.duration !== undefined && Date.parse(e.timestamp) > now.getTime() - 60_000)
  return { workerId: 'worker-local-01', alive, healthy, heartbeat, busy: running > 0, running, capacity: pipelineConfig.workerConcurrency, completedLastMinute, oldestWaitMs: waitMs, waitingOver10Min: overdue.filter(r => now.getTime() - Date.parse(r.runAt) > 600_000).length, stalled: rows.filter(r => r.state === 'running' && !!r.lease && r.lease < iso).length, attention: rows.filter(r => r.state === 'failed' || (r.state === 'running' && !!r.lease && r.lease < iso)).length, networkLatencyMs: network.length ? Math.round(network.reduce((sum, e) => sum + e.duration!, 0) / network.length) : null }
}

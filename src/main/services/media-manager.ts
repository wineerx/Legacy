import { MEDIA_STATE_LABELS } from '@shared/types'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { JobState, MediaDetails, MediaUsage } from '@shared/types'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { jobs, mediaAssets, mediaVersions, publicationHistory, remotePosts, trackedProfiles } from '../db/schema'
import { getAsset } from '../repos/assets'
import { probe } from '../media/probe'
import { rmSync } from 'node:fs'
import { deleteAssetRow } from '../repos/assets'
import { storedAssetDir } from './library'
import { requireWorkspace } from './integrations'

// Correlated SQL is reused by status filters, details and deletion guards.
export const relatedJob = (): SQL => sql`(${jobs.workspaceId} = ${mediaAssets.workspaceId} AND (
 json_extract(${jobs.payloadJson}, '$.assetId') = ${mediaAssets.id}
 OR json_extract(${jobs.payloadJson}, '$.localAssetId') = ${mediaAssets.id}
 OR EXISTS (SELECT 1 FROM json_each(${jobs.payloadJson}, '$.assetIds') WHERE value = ${mediaAssets.id})
 OR EXISTS (SELECT 1 FROM ${remotePosts} WHERE ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} AND ${remotePosts.assetId} = ${mediaAssets.id} AND ${remotePosts.id} = json_extract(${jobs.payloadJson}, '$.postId'))))`
export const hasJob = (states: JobState[], types?: string[]): SQL => sql`EXISTS (SELECT 1 FROM ${jobs} WHERE ${relatedJob()} AND ${inArray(jobs.state, states)} ${types ? sql`AND ${inArray(jobs.type, types)}` : sql``})`
export const hasPublication = (): SQL => sql`EXISTS (SELECT 1 FROM ${publicationHistory} WHERE ${publicationHistory.workspaceId} = ${mediaAssets.workspaceId} AND (${publicationHistory.assetSha} = ${mediaAssets.sha256} OR EXISTS (SELECT 1 FROM ${remotePosts} WHERE ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} AND ${remotePosts.assetId} = ${mediaAssets.id} AND ${remotePosts.id} = ${publicationHistory.postId})))`

export async function deleteMany(ctx: Ctx, ws: string, ids: string[]) {
  requireWorkspace(ctx, ws)
  const result = { deleted: [] as string[], blocked: [] as string[], failed: [] as string[] }
  for (const id of new Set(ids)) {
    try {
      ctx.db.transaction(() => {
        const asset = getAsset(ctx.db, ws, id)
        if (!asset) { result.failed.push(id); return }
        const busy = ctx.db.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.workspaceId, ws), eq(mediaAssets.id, id), hasJob(['queued', 'running']))).get()
        if (busy) { result.blocked.push(id); return }
        // Hold the writer lock until disk deletion and row removal finish. A worker
        // cannot acquire a new lease or schedule a reference between the two.
        rmSync(storedAssetDir(ctx, ws, id), { recursive: true, force: true })
        deleteAssetRow(ctx.db, ws, id)
        result.deleted.push(id)
      }, { behavior: 'immediate' })
    } catch { result.failed.push(id) }

  }
  return result
}

export function pendingMedia(ctx: Ctx, ws: string) {
  requireWorkspace(ctx, ws)
  return ctx.db.select({ id: jobs.id, label: jobs.label, state: jobs.state, error: jobs.lastError }).from(jobs)
    .where(and(eq(jobs.workspaceId, ws), inArray(jobs.type, ['download_reel', 'make_thumbnail']), inArray(jobs.state, ['queued', 'running', 'failed'])))
    .orderBy(desc(jobs.updatedAt)).limit(100).all() as { id: string; label: string; state: 'queued' | 'running' | 'failed'; error: string | null }[]
}

export async function mediaDetails(ctx: Ctx, ws: string, id: string, offset = 0): Promise<MediaDetails> {
  requireWorkspace(ctx, ws)
  const asset = getAsset(ctx.db, ws, id)
  if (!asset) throw new AppError('not_found', 'Mídia não encontrada.')
  if (asset.audioCodec === null) {
    const p = await probe(asset.filePath, true)
    asset.audioCodec = p.audioCodec ?? 'none'
    ctx.db.update(mediaAssets).set({ audioCodec: asset.audioCodec }).where(and(eq(mediaAssets.workspaceId, ws), eq(mediaAssets.id, id))).run()
  }
  const post = ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, ws), eq(remotePosts.assetId, id))).orderBy(desc(remotePosts.metricsUpdatedAt)).get()
  const profile = post ? ctx.db.select().from(trackedProfiles).where(and(eq(trackedProfiles.workspaceId, ws), eq(trackedProfiles.id, post.profileId))).get() : null
  const publicationMatch = and(eq(publicationHistory.workspaceId, ws), or(eq(publicationHistory.assetSha, asset.sha256), sql`EXISTS (SELECT 1 FROM ${remotePosts} WHERE ${remotePosts.workspaceId} = ${ws} AND ${remotePosts.assetId} = ${id} AND ${remotePosts.id} = ${publicationHistory.postId})`))
  const histories = ctx.db.select().from(publicationHistory).where(publicationMatch)
    .orderBy(desc(publicationHistory.publishedAt)).limit(50).offset(offset).all()
  const publicationTotal = ctx.db.select({ n: sql<number>`count(*)` }).from(publicationHistory).where(publicationMatch).get()!.n
  const related = ctx.db.select({ job: jobs }).from(jobs).innerJoin(mediaAssets, relatedJob()).where(and(eq(mediaAssets.workspaceId, ws), eq(mediaAssets.id, id))).orderBy(desc(jobs.updatedAt)).limit(100).all().map(r => r.job)
  const publications: MediaUsage[] = histories.map(h => ({ id: h.jobId, platform: 'Instagram', account: h.username, state: 'published', at: h.publishedAt, error: null }))
  for (const j of related) {
    if (!['publish_instagram', 'export_tiktok'].includes(j.type) || j.state === 'cancelled' || (j.type === 'publish_instagram' && j.state === 'done')) continue
    const p = JSON.parse(j.payloadJson)
    publications.push({ id: j.id, platform: j.type === 'export_tiktok' ? 'TikTok' : 'Instagram', account: p.username ?? /@([^ ]+)/.exec(j.label)?.[1] ?? p.accountId ?? null,
      state: j.type === 'export_tiktok' && j.state === 'done' ? 'exported' : j.state === 'queued' ? 'scheduled' : j.state, at: j.runAt, error: j.lastError })
  }
  const banner = ctx.db.select().from(mediaVersions).where(and(eq(mediaVersions.workspaceId, ws), eq(mediaVersions.assetId, id), eq(mediaVersions.kind, 'banner'))).orderBy(desc(mediaVersions.createdAt)).get()
  const timeline = [{ at: asset.importedAt, label: asset.origin === 'pc' ? 'Importado do computador' : `Download concluído${profile ? ` de @${profile.username}` : ''}` },
    ...related.filter(j => j.type === 'make_thumbnail' && j.state === 'done').map(j => ({ at: j.updatedAt, label: 'Miniatura gerada' })),
    ...publications.map(p => ({ at: p.at, label: `${p.platform}: ${MEDIA_STATE_LABELS[p.state] ?? p.state}${p.account ? ` · @${p.account}` : ''}` }))].sort((a, b) => a.at.localeCompare(b.at))
  return { name: asset.sourceName, sizeBytes: asset.sizeBytes, durationMs: asset.durationMs, width: asset.width, height: asset.height, audioCodec: asset.audioCodec,
    origin: asset.origin, sourceProfile: profile?.username ?? null, permalink: post?.permalink ?? null, importedAt: asset.importedAt, metricsUpdatedAt: post?.metricsUpdatedAt ?? null,
    publications, publicationTotal, timeline, bannerPath: banner?.filePath ?? null }
}

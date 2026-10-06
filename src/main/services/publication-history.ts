import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, mediaAssets, publicationHistory, remotePosts, trackedProfiles } from '../db/schema'
import { deleteAsset } from './library'
import { getSetting, setSetting } from '../repos/settings'

export function history(ctx: Ctx, ws: string) {
  return ctx.db.select().from(publicationHistory).where(eq(publicationHistory.workspaceId, ws)).orderBy(desc(publicationHistory.publishedAt)).all()
}

export async function recordPublication(ctx: Ctx, input: { workspaceId: string; jobId: string; accountId: string; username: string; postId: string | null; assetId?: string | null; mediaId?: string; cleanup?: boolean; cleanupAssetId?: string | null }) {
  const { workspaceId: ws, jobId, postId } = input
  const post = postId ? ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, ws), eq(remotePosts.id, postId))).get() : undefined
  const assetId = input.assetId ?? post?.assetId
  const asset = assetId ? ctx.db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, ws), eq(mediaAssets.id, assetId))).get() : undefined
  const profile = post ? ctx.db.select().from(trackedProfiles).where(and(eq(trackedProfiles.workspaceId, ws), eq(trackedProfiles.id, post.profileId))).get() : undefined
  ctx.db.insert(publicationHistory).values({ workspaceId: ws, jobId, accountId: input.accountId, username: input.username, postId,
    assetSha: asset?.sha256 ?? null, mediaId: input.mediaId ?? null, publishedAt: ctx.clock().toISOString(),
    provenanceJson: JSON.stringify({ sourceName: asset?.sourceName ?? null, platform: profile?.platform ?? null, remoteId: post?.remoteId ?? null, profile: profile?.username ?? null, permalink: post?.permalink ?? null, caption: post?.caption ?? null, views: post?.views ?? null, likes: post?.likes ?? null, comments: post?.comments ?? null, assetId: asset?.id ?? null, downloadedAt: asset?.importedAt ?? null }),
    cleanupState: input.cleanup ? 'pending' : 'kept'
  }).onConflictDoNothing().run()
  const row = ctx.db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId, ws), eq(publicationHistory.jobId, jobId))).get()!
  if (!input.cleanup || row.cleanupState !== 'pending') return row
  let cleanupState = 'no_local_copy'
  if (asset && (input.cleanupAssetId === undefined || input.cleanupAssetId === asset.id)) {
    // A scheduled/export/editing job may still need this same local copy. Keep it in that case.
    const active = ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), inArray(jobs.state, ['queued', 'running']))).all()
    const busy = active.some(j => {
      if (j.id === jobId) return false
      const p = JSON.parse(j.payloadJson)
      if (p.assetId === asset.id || p.localAssetId === asset.id || p.assetIds?.includes(asset.id)) return true
      if (p.postId) return ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, ws), eq(remotePosts.id, p.postId))).get()?.assetId === asset.id
      return false
    })
    if (busy) cleanupState = 'kept_in_use'
    else {
      try { await deleteAsset(ctx, ws, asset.id); cleanupState = 'deleted' }
      catch { cleanupState = 'cleanup_failed' } // A disk failure must never cause another publish POST.
    }
  }
  ctx.db.update(publicationHistory).set({ cleanupState }).where(and(eq(publicationHistory.workspaceId, ws), eq(publicationHistory.jobId, jobId))).run()
  return { ...row, cleanupState }
}

// Initialize before starting the worker, so old publications never replay celebrations.
export function publicationFeedback(ctx: Ctx, ws: string) {
  const rows = history(ctx, ws)
  const stored = getSetting(ctx.db, ws, 'publicationFeedbackAck')
  if (stored === null) {
    setSetting(ctx.db, ws, 'publicationFeedbackAck', JSON.stringify(rows.map(r => r.jobId)))
    return []
  }
  const acknowledged = new Set(JSON.parse(stored) as string[])
  return rows.filter(r => !acknowledged.has(r.jobId)).slice(0, 100).map(r => ({ jobId: r.jobId, username: r.username }))
}
export function acknowledgePublications(ctx: Ctx, ws: string, ids: string[]) {
  const published = new Set(history(ctx, ws).map(r => r.jobId))
  const old = JSON.parse(getSetting(ctx.db, ws, 'publicationFeedbackAck') ?? '[]') as string[]
  setSetting(ctx.db, ws, 'publicationFeedbackAck', JSON.stringify([...new Set([...old, ...ids.filter(id => published.has(id))])]))
}

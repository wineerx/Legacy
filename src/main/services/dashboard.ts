import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, mediaAssets, remotePosts, trackedProfiles, publicationContainers } from '../db/schema'
import { instagramAccount } from './instagram-publishing'
import { readQuotaSnapshot } from './instagram-quota'
import { unreadCount } from '../repos/notifications'
import { requireWorkspace } from './integrations'

export function dashboard(ctx: Ctx, ws: string) {
  requireWorkspace(ctx, ws)
  const states = ctx.db.select({ state: jobs.state, count: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.workspaceId, ws), sql`${jobs.type} != 'webhook_delivery'`)).groupBy(jobs.state).all()
  const tasks = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, total: 0 }
  for (const row of states) { tasks[row.state] = row.count; tasks.total += row.count }
  const library = ctx.db.select({ count: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)` }).from(mediaAssets).where(eq(mediaAssets.workspaceId, ws)).get()!
  const metrics = ctx.db.select({
    id: trackedProfiles.id, username: trackedProfiles.username, lastSyncedAt: trackedProfiles.lastSyncedAt,
    posts: sql<number>`count(${remotePosts.id})`, downloaded: sql<number>`count(${remotePosts.assetId})`,
    views: sql<number | null>`sum(${remotePosts.views})`, likes: sql<number | null>`sum(${remotePosts.likes})`, comments: sql<number | null>`sum(${remotePosts.comments})`,
    viewsKnown: sql<number>`count(${remotePosts.views})`, likesKnown: sql<number>`count(${remotePosts.likes})`, commentsKnown: sql<number>`count(${remotePosts.comments})`,
    metricsUpdatedAt: sql<string | null>`max(${remotePosts.metricsUpdatedAt})`
  }).from(trackedProfiles).leftJoin(remotePosts, and(eq(remotePosts.profileId, trackedProfiles.id), eq(remotePosts.workspaceId, ws)))
    .where(eq(trackedProfiles.workspaceId, ws)).groupBy(trackedProfiles.id).orderBy(trackedProfiles.username).all()
  const recent = ctx.db.select({ id: jobs.id, label: jobs.label, state: jobs.state, updatedAt: jobs.updatedAt, runAt: jobs.runAt,
    media: sql<string | null>`(select m.source_name from media_assets m where m.workspace_id = ${jobs.workspaceId} and m.id = json_extract(${jobs.payloadJson}, '$.localAssetId'))` }).from(jobs)
    .where(and(eq(jobs.workspaceId, ws), sql`${jobs.type} != 'webhook_delivery'`)).orderBy(desc(jobs.updatedAt), desc(jobs.createdAt)).limit(8).all()
  const now = ctx.clock().toISOString()
  const next = ctx.db.select({ id: publicationContainers.id, name: publicationContainers.name, plannedStartAt: publicationContainers.plannedStartAt, plannedEndAt: publicationContainers.plannedEndAt })
    .from(publicationContainers).where(and(eq(publicationContainers.workspaceId, ws), isNotNull(publicationContainers.scheduledAt), eq(publicationContainers.controlState, 'active'), sql`${publicationContainers.plannedEndAt} >= ${now}`))
    .orderBy(publicationContainers.plannedStartAt).limit(1).get() ?? null
  const account = instagramAccount(ctx, ws)
  const reading = account ? readQuotaSnapshot(ctx.db, ws, account.id, ctx.clock()) : null
  const quota = account ? { username: account.username, usage: reading?.usage ?? null, total: reading?.total ?? null, durationSec: reading?.durationSec ?? null, fetchedAt: reading?.fetchedAt ?? null, freshness: reading?.freshness ?? 'missing' as const } : null
  return { tasks, library, profiles: metrics, recent, unread: unreadCount(ctx.db, ws, ctx.clock()), nextContainer: next, quota }
}

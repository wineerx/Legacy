import { and, desc, eq, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, mediaAssets, remotePosts, trackedProfiles } from '../db/schema'
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
  const recent = ctx.db.select({ id: jobs.id, label: jobs.label, state: jobs.state, updatedAt: jobs.updatedAt }).from(jobs)
    .where(and(eq(jobs.workspaceId, ws), sql`${jobs.type} != 'webhook_delivery'`)).orderBy(desc(jobs.updatedAt), desc(jobs.createdAt)).limit(8).all()
  return { tasks, library, profiles: metrics, recent, unread: unreadCount(ctx.db, ws, ctx.clock()) }
}

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, mediaAssets, publicationHistory, remotePosts, trackedProfiles, workspaces } from '../db/schema'
import { addDays, localDate } from '@shared/agenda'
import type { DashboardAnalytics } from '@shared/types'

export const ACTIVITY_DAYS = 14

/** Real counts only: days without events are 0 events, never invented metrics. Days follow the workspace time zone. */
export function analytics(ctx: Ctx, ws: string): DashboardAnalytics {
  const timeZone = ctx.db.select({ tz: workspaces.timeZone }).from(workspaces).where(eq(workspaces.id, ws)).get()?.tz ?? 'UTC'
  const now = ctx.clock()
  const today = localDate(now.getTime(), timeZone)
  const days = Array.from({ length: ACTIVITY_DAYS }, (_, i) => addDays(today, i - ACTIVITY_DAYS + 1))
  // One extra day of margin covers every UTC offset; bucketing below discards anything outside the window.
  const since = new Date(Date.parse(`${days[0]}T00:00:00Z`) - 86_400_000).toISOString()
  const activity = days.map(day => ({ day, published: 0, imported: 0, failed: 0 }))
  const index = new Map(days.map((d, i) => [d, i]))
  const bump = (iso: string, key: 'published' | 'imported' | 'failed') => { const i = index.get(localDate(Date.parse(iso), timeZone)); if (i !== undefined) activity[i][key]++ }
  for (const r of ctx.db.select({ at: publicationHistory.publishedAt }).from(publicationHistory).where(and(eq(publicationHistory.workspaceId, ws), gte(publicationHistory.publishedAt, since))).all()) bump(r.at, 'published')
  for (const r of ctx.db.select({ at: mediaAssets.importedAt }).from(mediaAssets).where(and(eq(mediaAssets.workspaceId, ws), gte(mediaAssets.importedAt, since))).all()) bump(r.at, 'imported')
  for (const r of ctx.db.select({ at: jobs.updatedAt }).from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.state, 'failed'), gte(jobs.updatedAt, since), sql`${jobs.type} != 'webhook_delivery'`)).all()) bump(r.at, 'failed')

  const origins = ctx.db.select({ origin: mediaAssets.origin, count: sql<number>`count(*)` }).from(mediaAssets).where(eq(mediaAssets.workspaceId, ws)).groupBy(mediaAssets.origin).all()
  const jobTypes = ctx.db.select({ type: jobs.type, done: sql<number>`sum(case when ${jobs.state} = 'done' then 1 else 0 end)`, failed: sql<number>`sum(case when ${jobs.state} = 'failed' then 1 else 0 end)`, total: sql<number>`count(*)` })
    .from(jobs).where(and(eq(jobs.workspaceId, ws), sql`${jobs.type} != 'webhook_delivery'`)).groupBy(jobs.type).orderBy(desc(sql`count(*)`)).all()
  const topPosts = ctx.db.select({ id: remotePosts.id, username: trackedProfiles.username, caption: remotePosts.caption, permalink: remotePosts.permalink, thumbnailPath: remotePosts.thumbnailPath, views: remotePosts.views, likes: remotePosts.likes, comments: remotePosts.comments })
    .from(remotePosts).innerJoin(trackedProfiles, eq(trackedProfiles.id, remotePosts.profileId))
    .where(and(eq(remotePosts.workspaceId, ws), isNotNull(remotePosts.views))).orderBy(desc(remotePosts.views)).limit(5).all()
  const accounts = ctx.db.select({ username: publicationHistory.username, count: sql<number>`count(*)`, lastAt: sql<string>`max(${publicationHistory.publishedAt})` })
    .from(publicationHistory).where(eq(publicationHistory.workspaceId, ws)).groupBy(publicationHistory.username).orderBy(desc(sql`count(*)`)).limit(6).all()
  return { activity, origins, jobTypes, topPosts, accounts }
}

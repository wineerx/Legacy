import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { remotePosts, trackedProfiles } from '../db/schema'
import { requireWorkspace } from './integrations'

export function topCaptions(ctx: Ctx, ws: string, sortBy: 'views' | 'likes' | 'comments', profileId?: string) {
  requireWorkspace(ctx, ws)
  const metric = remotePosts[sortBy]
  const conditions = [eq(remotePosts.workspaceId, ws), isNotNull(metric), sql`length(trim(coalesce(${remotePosts.caption}, ''))) > 0`]
  if (profileId) conditions.push(eq(remotePosts.profileId, profileId))
  const rows = ctx.db.select({ id: remotePosts.id, username: trackedProfiles.username, text: remotePosts.caption, permalink: remotePosts.permalink, value: metric, updatedAt: remotePosts.metricsUpdatedAt, source: remotePosts.metricsSource })
    .from(remotePosts).innerJoin(trackedProfiles, and(eq(trackedProfiles.id, remotePosts.profileId), eq(trackedProfiles.workspaceId, ws)))
    .where(and(...conditions)).orderBy(desc(metric), desc(remotePosts.postedAt), remotePosts.id).limit(20).all()
  const total = ctx.db.select({ count: sql<number>`count(*)` }).from(remotePosts).where(and(...conditions)).get()!.count
  return { items: rows, total, sortBy, note: `Ranking por ${sortBy === 'views' ? 'visualizações' : sortBy === 'likes' ? 'curtidas' : 'comentários'} dos ${total} posts carregados com legenda e essa métrica disponível. Não mede o efeito isolado da legenda.` }
}

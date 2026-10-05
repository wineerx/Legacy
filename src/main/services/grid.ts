import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { AppError } from '@shared/errors'
import type { Badge, GridItem, GridPage, GridQuery } from '@shared/types'
import type { Db } from '../db/client'
import { jobs, mediaAssets, remotePosts, publicationHistory, trackedProfiles } from '../db/schema'
import { getSetting } from '../repos/settings'

const iso = (v: string) => new Date(v).toISOString()
const contains = (col: SQLiteColumn, needle: string) => sql`instr(lower(coalesce(${col}, '')), lower(${needle})) > 0`

function orderFor(col: SQLiteColumn, dir: 'asc' | 'desc'): SQL[] {
  return [sql`${col} is null`, dir === 'asc' ? asc(col) : desc(col)]
}

function exportedAssetIds(db: Db, workspaceId: string): Set<string> {
  const rows = db.select({ p: jobs.payloadJson }).from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, 'export_tiktok'), eq(jobs.state, 'done'))).all()
  const ids = new Set<string>()
  for (const r of rows) for (const id of (JSON.parse(r.p).assetIds ?? []) as string[]) ids.add(id)
  return ids
}

function remoteGrid(db: Db, q: GridQuery): GridPage {
  if (!q.profileId) throw new AppError('invalid_input', 'Escolha um perfil.')
  const where: SQL[] = [eq(remotePosts.workspaceId, q.workspaceId), eq(remotePosts.profileId, q.profileId)]
  if (q.text) where.push(contains(remotePosts.caption, q.text))
  if (q.hashtag) where.push(contains(remotePosts.caption, `#${q.hashtag.replace(/^#/, '')}`))
  if (q.from) where.push(gte(remotePosts.postedAt, iso(q.from)))
  if (q.to) where.push(lte(remotePosts.postedAt, iso(q.to)))
  if (q.maxDurationMs !== undefined) where.push(lte(remotePosts.durationMs, q.maxDurationMs))
  if (q.minViews !== undefined) where.push(gte(remotePosts.views, q.minViews))
  if (q.minLikes !== undefined) where.push(gte(remotePosts.likes, q.minLikes))
  if (q.minComments !== undefined) where.push(gte(remotePosts.comments, q.minComments))
  if (q.favoritesOnly) where.push(eq(remotePosts.favorite, true))
  if (q.mediaKind === 'videos') where.push(sql`(${remotePosts.mediaProductType} IN ('REELS', 'VIDEO') OR ${remotePosts.assetId} IS NOT NULL)`)
  if (q.mediaKind === 'images') where.push(sql`${remotePosts.mediaProductType} IN ('IMAGE', 'CAROUSEL')`)
  const cond = and(...where)
  const sortCol: SQLiteColumn = ({ views: remotePosts.views, likes: remotePosts.likes, comments: remotePosts.comments, postedAt: remotePosts.postedAt, durationMs: remotePosts.durationMs, importedAt: remotePosts.postedAt } as const)[q.sortBy]
  const rows = db.select().from(remotePosts).where(cond).orderBy(...orderFor(sortCol, q.sortDir), asc(remotePosts.permalink)).limit(q.limit).offset(q.offset).all()
  const total = db.select({ n: sql<number>`count(*)` }).from(remotePosts).where(cond).get()!.n
  const loaded = db.select({ n: sql<number>`count(*)` }).from(remotePosts)
    .where(and(eq(remotePosts.workspaceId, q.workspaceId), eq(remotePosts.profileId, q.profileId))).get()!.n
  const items: GridItem[] = rows.map((r) => {
    const badges: Badge[] = [r.assetId ? 'baixado' : 'link']
    const publishedAccounts = [...new Set(db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId, q.workspaceId), eq(publicationHistory.postId, r.id))).all().map(h => h.username))]
    if (publishedAccounts.length) badges.push('publicado')
    if (r.favorite) badges.push('favorito')
    return {
      id: r.id, kind: 'remote', thumbnailPath: r.thumbnailPath ?? (r.assetId ? db.select({ path: mediaAssets.thumbnailPath }).from(mediaAssets).where(and(eq(mediaAssets.workspaceId, q.workspaceId), eq(mediaAssets.id, r.assetId))).get()?.path ?? null : null), permalink: r.permalink, caption: r.caption,
      postedAt: r.postedAt, durationMs: r.durationMs, metrics: { views: r.views, likes: r.likes, comments: r.comments }, badges,
      publishedAccounts, assetId: r.assetId, filePath: r.assetId ? db.select({ path: mediaAssets.filePath }).from(mediaAssets).where(and(eq(mediaAssets.workspaceId, q.workspaceId), eq(mediaAssets.id, r.assetId))).get()?.path ?? null : null, ...JSON.parse(getSetting(db, q.workspaceId, `remoteMedia.${r.id}`) ?? '{}')
    }
  })
  return { items, total, loadedNote: `Ranking cobre os ${loaded} posts carregados deste perfil.` }
}

function libraryGrid(db: Db, q: GridQuery): GridPage {
  const where: SQL[] = [eq(mediaAssets.workspaceId, q.workspaceId)]
  if (q.text) where.push(contains(mediaAssets.sourceName, q.text))
  if (q.hashtag) where.push(contains(mediaAssets.sourceName, `#${q.hashtag.replace(/^#/, '')}`))
  const metricColumn = (key: 'views' | 'likes' | 'comments') => sql`(select ${remotePosts[key]} from ${remotePosts} where ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} and ${remotePosts.assetId} = ${mediaAssets.id} order by ${remotePosts.metricsUpdatedAt} desc, ${remotePosts.id} asc limit 1)`
  if (q.minViews !== undefined) where.push(sql`${metricColumn('views')} >= ${q.minViews}`)
  if (q.minLikes !== undefined) where.push(sql`${metricColumn('likes')} >= ${q.minLikes}`)
  if (q.minComments !== undefined) where.push(sql`${metricColumn('comments')} >= ${q.minComments}`)
  if (q.from) where.push(gte(mediaAssets.importedAt, iso(q.from)))
  if (q.to) where.push(lte(mediaAssets.importedAt, iso(q.to)))
  if (q.maxDurationMs !== undefined) where.push(lte(mediaAssets.durationMs, q.maxDurationMs))
  if (q.favoritesOnly) where.push(eq(mediaAssets.favorite, true))
  const order = q.sortBy === 'durationMs' ? orderFor(mediaAssets.durationMs, q.sortDir)
    : q.sortBy === 'importedAt' ? orderFor(mediaAssets.importedAt, q.sortDir)
    : ['views', 'likes', 'comments'].includes(q.sortBy) ? [sql`${metricColumn(q.sortBy as 'views' | 'likes' | 'comments')} is null`, q.sortDir === 'asc' ? asc(metricColumn(q.sortBy as 'views' | 'likes' | 'comments')) : desc(metricColumn(q.sortBy as 'views' | 'likes' | 'comments')), desc(mediaAssets.importedAt)] : orderFor(mediaAssets.importedAt, 'desc')
  const cond = and(...where)
  const rows = db.select().from(mediaAssets).where(cond).orderBy(...order, asc(mediaAssets.id)).limit(q.limit).offset(q.offset).all()
  const total = db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(cond).get()!.n
  const loaded = db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(eq(mediaAssets.workspaceId, q.workspaceId)).get()!.n
  const exported = exportedAssetIds(db, q.workspaceId)
  const items: GridItem[] = rows.map((r) => {
    const badges: Badge[] = []
    if (r.origin === 'ig_own' || r.origin === 'ig_third_party') badges.push('baixado')
    if (exported.has(r.id)) badges.push('exportado')
    if (r.favorite) badges.push('favorito')
    const post = db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, q.workspaceId), eq(remotePosts.assetId, r.id))).orderBy(desc(remotePosts.metricsUpdatedAt), asc(remotePosts.id)).get()
    const publishedAccounts = [...new Set(db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId, q.workspaceId), eq(publicationHistory.assetSha, r.sha256))).all().map(h => h.username))]
    if (publishedAccounts.length) badges.push('publicado')
    const sourceProfile = post ? db.select().from(trackedProfiles).where(and(eq(trackedProfiles.workspaceId, q.workspaceId), eq(trackedProfiles.id, post.profileId))).get()?.username : null
    return {
      id: r.id, kind: 'asset', filePath: r.filePath, thumbnailPath: r.thumbnailPath, permalink: post?.permalink ?? null, caption: post?.caption ?? r.sourceName,
      postedAt: r.importedAt, durationMs: r.durationMs, metrics: { views: post?.views ?? null, likes: post?.likes ?? null, comments: post?.comments ?? null }, badges, publishedAccounts, sourceProfile
    }
  })
  return { items, total, loadedNote: `${loaded} vídeos na biblioteca.` }
}

export function queryGrid(db: Db, q: GridQuery): GridPage {
  return q.source === 'remote' ? remoteGrid(db, q) : libraryGrid(db, q)
}

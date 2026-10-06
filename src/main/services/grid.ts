import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { and, asc, desc, eq, gte, lte, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { AppError } from '@shared/errors'
import type { Badge, GridItem, GridPage, GridQuery } from '@shared/types'
import type { Db } from '../db/client'
import { jobs, mediaAssets, remotePosts, publicationHistory, trackedProfiles } from '../db/schema'
import { hasJob, hasPublication } from './media-manager'
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
  if (q.assetId) where.push(eq(mediaAssets.id, q.assetId))
  const sourceMatch = (extra: SQL) => sql`EXISTS (SELECT 1 FROM ${remotePosts} LEFT JOIN ${trackedProfiles} ON ${trackedProfiles.id} = ${remotePosts.profileId} AND ${trackedProfiles.workspaceId} = ${remotePosts.workspaceId} WHERE ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} AND ${remotePosts.assetId} = ${mediaAssets.id} AND ${extra})`
  if (q.text) where.push(or(contains(mediaAssets.sourceName, q.text), sourceMatch(or(contains(remotePosts.caption, q.text), contains(trackedProfiles.username, q.text), contains(remotePosts.permalink, q.text))!))!)
  if (q.sourceProfile) where.push(sourceMatch(contains(trackedProfiles.username, q.sourceProfile.replace(/^@/, ''))))
  if (q.hashtag) where.push(sourceMatch(contains(remotePosts.caption, `#${q.hashtag.replace(/^#/, '')}`)))
  if (q.publicationAccount) where.push(sql`EXISTS (SELECT 1 FROM ${publicationHistory} WHERE ${publicationHistory.workspaceId} = ${mediaAssets.workspaceId} AND (${publicationHistory.assetSha} = ${mediaAssets.sha256} OR EXISTS (SELECT 1 FROM ${remotePosts} WHERE ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} AND ${remotePosts.assetId} = ${mediaAssets.id} AND ${remotePosts.id} = ${publicationHistory.postId})) AND ${contains(publicationHistory.username, q.publicationAccount.replace(/^@/, ''))})`)
  if (q.platform === 'instagram') where.push(or(sourceMatch(sql`${trackedProfiles.platform} = 'instagram'`), hasPublication(), hasJob(['queued', 'running', 'failed'], ['publish_instagram']))!)
  if (q.platform === 'tiktok') where.push(or(sourceMatch(sql`${trackedProfiles.platform} = 'tiktok'`), hasJob(['queued', 'running', 'done', 'failed'], ['export_tiktok']))!)
  const state = sql`CASE WHEN ${hasJob(['queued', 'running'], ['make_thumbnail', 'apply_banner'])} THEN 'processing' WHEN ${hasJob(['queued', 'running'], ['publish_instagram'])} THEN 'scheduled' WHEN ${hasJob(['failed'])} THEN 'failed' WHEN ${hasPublication()} THEN 'published' ELSE 'ready' END`
  if (q.status === 'unpublished') where.push(sql`NOT ${hasPublication()}`)
  else if (q.status) where.push(sql`${state} = ${q.status}`)
  const metricColumn = (key: 'views' | 'likes' | 'comments') => sql`(select ${remotePosts[key]} from ${remotePosts} where ${remotePosts.workspaceId} = ${mediaAssets.workspaceId} and ${remotePosts.assetId} = ${mediaAssets.id} order by ${remotePosts.metricsUpdatedAt} desc, ${remotePosts.id} asc limit 1)`
  if (q.minViews !== undefined) where.push(sql`${metricColumn('views')} >= ${q.minViews}`)
  if (q.minLikes !== undefined) where.push(sql`${metricColumn('likes')} >= ${q.minLikes}`)
  if (q.minComments !== undefined) where.push(sql`${metricColumn('comments')} >= ${q.minComments}`)
  if (q.from) where.push(gte(mediaAssets.importedAt, iso(q.from)))
  if (q.to) where.push(lte(mediaAssets.importedAt, iso(q.to)))
  if (q.maxDurationMs !== undefined) where.push(lte(mediaAssets.durationMs, q.maxDurationMs))
  if (q.favoritesOnly) where.push(eq(mediaAssets.favorite, true))
  const order = q.sortBy === 'durationMs' ? orderFor(mediaAssets.durationMs, q.sortDir)
    : (q.sortBy === 'views' || q.sortBy === 'likes' || q.sortBy === 'comments') ? [sql`${metricColumn(q.sortBy as 'views' | 'likes' | 'comments')} is null`, q.sortDir === 'asc' ? asc(metricColumn(q.sortBy as 'views' | 'likes' | 'comments')) : desc(metricColumn(q.sortBy as 'views' | 'likes' | 'comments')), desc(mediaAssets.importedAt)] : orderFor(mediaAssets.importedAt, q.sortBy === 'importedAt' ? q.sortDir : 'desc')
  const cond = and(...where)
  const rows = db.select({ asset: mediaAssets, state: state.as('media_state'), exported: hasJob(['done'], ['export_tiktok']).as('exported') }).from(mediaAssets).where(cond).orderBy(...order, asc(mediaAssets.id)).limit(q.limit).offset(q.offset).all()
  const total = db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(cond).get()!.n
  const ids = rows.map(r => r.asset.id)
  const sha = rows.map(r => r.asset.sha256)
  const posts = ids.length ? db.select({ post: remotePosts, username: trackedProfiles.username, platform: trackedProfiles.platform }).from(remotePosts).leftJoin(trackedProfiles, and(eq(trackedProfiles.id, remotePosts.profileId), eq(trackedProfiles.workspaceId, q.workspaceId))).where(and(eq(remotePosts.workspaceId, q.workspaceId), inArray(remotePosts.assetId, ids), sql`${remotePosts.id} = (SELECT r.id FROM remote_posts r WHERE r.workspace_id = ${q.workspaceId} AND r.asset_id = ${remotePosts.assetId} ORDER BY r.metrics_updated_at DESC, r.id ASC LIMIT 1)`)).orderBy(desc(remotePosts.metricsUpdatedAt), asc(remotePosts.id)).all() : []
  const sourceIds = ids.length ? db.select({ id: remotePosts.id, assetId: remotePosts.assetId }).from(remotePosts).where(and(eq(remotePosts.workspaceId, q.workspaceId), inArray(remotePosts.assetId, ids))).all() : []
  const sourceAsset = new Map(sourceIds.map(p => [p.id, p.assetId]))
  const published = sha.length ? db.select({ sha: publicationHistory.assetSha, postId: publicationHistory.postId, username: publicationHistory.username }).from(publicationHistory).where(and(eq(publicationHistory.workspaceId, q.workspaceId), or(inArray(publicationHistory.assetSha, sha), sourceIds.length ? inArray(publicationHistory.postId, sourceIds.map(p => p.id)) : sql`0`))).groupBy(publicationHistory.assetSha, publicationHistory.postId, publicationHistory.username).all() : []
  const postMap = new Map<string, typeof posts[number]>()
  for (const post of posts) if (!postMap.has(post.post.assetId!)) postMap.set(post.post.assetId!, post)
  const accountMap = new Map<string, string[]>()
  const shaById = new Map(rows.map(r => [r.asset.id, r.asset.sha256]))
  for (const h of published) { const key = h.sha ?? shaById.get(sourceAsset.get(h.postId) ?? ''); if (key) accountMap.set(key, [...new Set([...(accountMap.get(key) ?? []), h.username])]) }
  const items: GridItem[] = rows.map(({ asset: r, state: st, exported }) => {
    const badges: Badge[] = []
    if (r.origin === 'ig_own' || r.origin === 'ig_third_party' || r.origin === 'tiktok_third_party') badges.push('baixado')
    if (exported) badges.push('exportado')
    if (r.favorite) badges.push('favorito')
    const source = postMap.get(r.id)
    const post = source?.post
    const publishedAccounts = accountMap.get(r.sha256) ?? []
    if (publishedAccounts.length) badges.push('publicado')
    if (st === 'scheduled') badges.push('agendado')
    return { id: r.id, kind: 'asset', postId: post?.id ?? null, filePath: r.filePath, firstFramePath: existsSync(join(dirname(r.filePath), 'first-frame.png')) ? join(dirname(r.filePath), 'first-frame.png') : null, thumbnailPath: r.thumbnailPath, permalink: post?.permalink ?? null, caption: post?.caption ?? r.sourceName,
      postedAt: r.importedAt, importedAt: r.importedAt, sizeBytes: r.sizeBytes, status: st as GridItem['status'], metricsUpdatedAt: post?.metricsUpdatedAt ?? null,
      durationMs: r.durationMs, metrics: { views: post?.views ?? null, likes: post?.likes ?? null, comments: post?.comments ?? null }, badges, publishedAccounts, sourcePlatform: source?.platform ?? null, sourceProfile: source?.username ?? null }
  })
  return { items, total, loadedNote: `${total} vídeos encontrados na biblioteca.` }
}

export function queryGrid(db: Db, q: GridQuery): GridPage {
  if (q.source === 'library' && q.publicationJobId) {
    const record = db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId, q.workspaceId), eq(publicationHistory.jobId, q.publicationJobId))).get()
    if (!record) throw new AppError('not_found', 'Publicação não encontrada neste workspace.')
    const post = db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, q.workspaceId), eq(remotePosts.id, record.postId))).get()
    const info = JSON.parse(record.provenanceJson)
    const asset = db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, q.workspaceId), or(eq(mediaAssets.id, post?.assetId ?? info.assetId ?? ''), eq(mediaAssets.sha256, record.assetSha ?? '')))).get()
    if (asset) return libraryGrid(db, { ...q, publicationJobId: undefined, assetId: asset.id })
    return { total: 1, loadedNote: 'A cópia local foi removida. O histórico da publicação permanece.', items: [{ id: record.postId, kind: 'remote', thumbnailPath: post?.thumbnailPath ?? null, permalink: post?.permalink ?? info.permalink ?? null, caption: post?.caption ?? info.caption ?? info.sourceName ?? 'Vídeo publicado', postedAt: record.publishedAt, durationMs: post?.durationMs ?? null, metrics: { views: post?.views ?? null, likes: post?.likes ?? null, comments: post?.comments ?? null }, badges: ['publicado'], publishedAccounts: [record.username] }] }
  }
  return q.source === 'remote' ? remoteGrid(db, q) : libraryGrid(db, q)
}

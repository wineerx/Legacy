import { and, eq, inArray } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import {
  jobs,
  mediaAssets,
  remotePosts,
  publicationHistory,
  trackedProfiles
} from '../db/schema'
import { requireWorkspace } from './integrations'

export function repostWarnings(
  ctx: Ctx,
  ws: string,
  accountId: string,
  input: { postIds?: string[]; assetIds?: string[] }
) {
  requireWorkspace(ctx, ws)
  const posts = ctx.db
    .select()
    .from(remotePosts)
    .where(eq(remotePosts.workspaceId, ws))
    .all()
  const assets = ctx.db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.workspaceId, ws))
    .all()
  const profiles = ctx.db
    .select()
    .from(trackedProfiles)
    .where(eq(trackedProfiles.workspaceId, ws))
    .all()
  const sourceKey = (p: (typeof posts)[number]) =>
    `${profiles.find((f) => f.id === p.profileId)?.platform}:${p.remoteId ?? p.permalink}`
  const published = ctx.db
    .select()
    .from(publicationHistory)
    .where(
      and(
        eq(publicationHistory.workspaceId, ws),
        eq(publicationHistory.accountId, accountId)
      )
    )
    .all()
  const active = ctx.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ws),
        eq(jobs.type, 'publish_instagram'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )
    .all()
  const targets = [
    ...[...new Set(input.postIds ?? [])].map(id => posts.find(p => p.id === id)?.assetId ?? id),
    ...new Set(input.assetIds ?? [])
  ]
  const seen = new Set<string>()
  const warnings = targets.flatMap((id) => {
    const asset = assets.find((a) => a.id === id)
    const related = posts.filter((p) => p.assetId === id || p.id === id)
    if (!asset && !related.length)
      throw new AppError(
        'not_found',
        'Conteúdo não encontrado neste workspace.'
      )
    const matching = posts.filter(
      (p) =>
        related.some(
          (r) =>
            r.id === p.id ||
            r.permalink === p.permalink ||
            sourceKey(r) === sourceKey(p)
        ) ||
        (asset &&
          p.assetId &&
          assets.find((a) => a.id === p.assetId)?.sha256 === asset.sha256)
    )
    const keys = new Set(matching.map((p) => p.id))
    const wasPublished = published.some((h) => {
      const origin = JSON.parse(h.provenanceJson)
      return (
        keys.has(h.postId) ||
        (asset && h.assetSha === asset.sha256) ||
        related.some((p) => p.permalink === origin.permalink || (origin.remoteId && sourceKey(p) === `${origin.platform}:${origin.remoteId}`))
      )
    })
    const inProgress = active.some((j) => {
      const p = JSON.parse(j.payloadJson)
      return (
        p.accountId === accountId &&
        (keys.has(p.postId) || p.localAssetId === id)
      )
    })
    const key = asset?.sha256 ?? related[0]?.permalink ?? id
    const withinBatch = seen.has(key)
    seen.add(key)
    if (!wasPublished && !inProgress && !withinBatch) return []
    return [
      {
        id,
        name: related[0]?.caption ?? asset?.sourceName ?? id,
        reason: wasPublished
          ? 'Este vídeo já foi publicado nesta conta.'
          : inProgress
            ? 'Este vídeo já possui uma publicação em andamento nesta conta.'
            : 'Este lote contém o mesmo vídeo mais de uma vez.'
      }
    ]
  })
  return [...new Map(warnings.map(row => [row.id, row])).values()]
}

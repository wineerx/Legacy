import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs } from '../db/schema'
import { getRemotePost } from '../repos/remote-posts'
import { getProfile } from '../repos/profiles'
import { getAsset } from '../repos/assets'
import { AppError } from '@shared/errors'

export function jobDetails(ctx: Ctx, ws: string, id: string) {
  const job = ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, id))).get()
  if (!job) throw new AppError('not_found', 'Tarefa não encontrada.')
  const payload = JSON.parse(job.payloadJson)
  const result = JSON.parse(job.resultJson ?? '{}')
  const post = payload.postId ? getRemotePost(ctx.db, ws, payload.postId) : null
  const profile = payload.profileId ? getProfile(ctx.db, ws, payload.profileId) : null
  const assetIds: string[] = [...new Set<string>([payload.assetId, post?.assetId, result.assetId, ...(payload.assetIds ?? [])].filter(Boolean))]
  const files = assetIds.map(id => getAsset(ctx.db, ws, id)).filter(a => a !== null).map(a => ({ id: a.id, name: a.sourceName, filePath: a.filePath, thumbnailPath: a.thumbnailPath }))
  return { label: job.label, runAt: job.runAt, error: job.lastError, files, originUrl: post?.permalink ?? profile?.url ?? null, folders: Array.isArray(result.folders) ? result.folders.filter((p: unknown): p is string => typeof p === 'string') : [] }
}

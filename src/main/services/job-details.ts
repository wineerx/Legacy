import { and, eq, desc, count } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, jobAttempts, publicationHistory } from '../db/schema'
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
  const profileId = payload.profileId ?? post?.profileId
  const profile = profileId ? getProfile(ctx.db, ws, profileId) : null
  const assetIds: string[] = [...new Set<string>([payload.assetId, payload.localAssetId, post?.assetId, result.assetId, ...(payload.assetIds ?? [])].filter(Boolean))]
  const files = assetIds.map(id => getAsset(ctx.db, ws, id)).filter(a => a !== null).map(a => ({ id: a.id, name: a.sourceName, filePath: a.filePath, thumbnailPath: a.thumbnailPath }))
  const attempts = ctx.db.select({ startedAt: jobAttempts.startedAt, finishedAt: jobAttempts.finishedAt, outcome: jobAttempts.outcome, errorMessage: jobAttempts.errorMessage }).from(jobAttempts).where(eq(jobAttempts.jobId,id)).orderBy(desc(jobAttempts.startedAt),desc(jobAttempts.id)).limit(50).all()
  const attemptTotal = ctx.db.select({ n: count() }).from(jobAttempts).where(eq(jobAttempts.jobId,id)).get()!.n
  const published = ctx.db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId, ws), eq(publicationHistory.jobId, id))).get()
  const provenance = published ? JSON.parse(published.provenanceJson) : null
  const checkpoint = job.type !== 'publish_instagram' ? null : (published || result.mediaId || result.confirmedPublished) ? 'Publicação confirmada pela API.' : result.publishing ? 'Envio iniciado; confirme no Instagram antes de tentar novamente. O registro remoto será preservado.' : result.containerId ? 'Mídia enviada à Meta; a próxima tentativa consultará o mesmo contêiner.' : result.creating ? 'Resposta da criação não confirmada. Confira o Instagram; uma nova mídia não será criada automaticamente.' : null
  return { confirmedPublished: Boolean(published || result.confirmedPublished || result.mediaId), publishedVideo: published ? { assetId: files[0]?.id ?? null, name: post?.caption ?? files[0]?.name ?? provenance?.caption ?? provenance?.sourceName ?? 'Vídeo publicado' } : null, attempts, attemptTotal, checkpoint, batchId: typeof payload.batchId === 'string' ? payload.batchId : null, account: typeof payload.username === 'string' ? payload.username : null, label: job.label, runAt: job.runAt, error: job.lastError, files, originUrl: post?.permalink ?? profile?.url ?? null, folders: Array.isArray(result.folders) ? result.folders.filter((p: unknown): p is string => typeof p === 'string') : [] }
}

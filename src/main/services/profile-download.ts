import { mkdir, rm } from 'node:fs/promises'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { normalizeInstagramUrl } from '@shared/instagram-url'
import type { Ctx } from '../context'
import { jobs, remotePosts, trackedProfiles } from '../db/schema'
import { enqueue, type LeasedJob } from '../queue/queue'
import { getProfile } from '../repos/profiles'
import { addReelLink, getRemotePost } from '../repos/remote-posts'
import { getAsset } from '../repos/assets'
import { addNotification } from '../repos/notifications'
import { resolveInside, workspaceDir } from '../paths'
import { importFiles } from './library'
import { allowedUrl, apifyJson, downloadVideo } from './download-http'
import { getSecret, notificationPreferences } from './integrations'

const remoteId = z.string().regex(/^[a-zA-Z0-9]+$/)
const runSchema = z.object({ data: z.object({ id: remoteId, status: z.string(), defaultDatasetId: remoteId.optional() }) })
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
export const reelSchema = z.object({
  url: z.string(), videoUrl: z.string(), id: z.string().optional(), caption: z.string().max(10000).optional(),
  timestamp: z.string().optional(), videoViewCount: z.unknown().optional(), likesCount: z.unknown().optional(), commentsCount: z.unknown().optional()
})

export function downloadConfigured(ctx: Ctx, ws: string): boolean { return Boolean(getSecret(ctx, ws, 'apifyToken')) }
function token(ctx: Ctx, ws: string): string {
  const value = getSecret(ctx, ws, 'apifyToken')
  if (!value) throw new AppError('invalid_input', 'Cadastre a chave Apify na Visão geral ou configure APIFY_TOKEN no ambiente.')
  return value
}

export function requestProfileDownload(ctx: Ctx, workspaceId: string, profileId: string, limit: number) {
  const profile = getProfile(ctx.db, workspaceId, profileId)
  if (!profile) throw new AppError('not_found', 'Perfil não encontrado.')
  token(ctx, workspaceId)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('invalid_input', 'Escolha de 1 a 100 vídeos.')
  const pending = ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.type, 'fetch_profile'), inArray(jobs.state, ['queued', 'running']))).all()
  const existing = pending.find((j) => JSON.parse(j.payloadJson).profileId === profileId)
  if (existing) throw new AppError('duplicate', 'Já existe uma busca deste perfil na fila.')
  return enqueue(ctx.db, { workspaceId, type: 'fetch_profile', payload: { profileId, limit }, label: `Buscar até ${limit} reels de @${profile.username}`, maxAttempts: 3 }, ctx.clock())
}

export async function fetchProfile(ctx: Ctx, job: LeasedJob): Promise<unknown> {
  const { profileId, limit } = z.object({ profileId: z.string(), limit: z.number().int().min(1).max(100) }).parse(job.payload)
  const profile = getProfile(ctx.db, job.workspaceId, profileId)
  if (!profile) throw new AppError('not_found', 'Perfil não encontrado.')
  const key = token(ctx, job.workspaceId)
  const condition = and(eq(jobs.workspaceId, job.workspaceId), eq(jobs.id, job.id))
  const saved = ctx.db.select().from(jobs).where(condition).get()?.resultJson
  let checkpoint: { starting?: boolean; runId?: string } = saved ? JSON.parse(saved) : {}
  if (!checkpoint.runId) {
    if (checkpoint.starting) throw new AppError('invalid_input', 'A criação da execução Apify ficou sem confirmação. Confira o console Apify antes de iniciar uma nova busca; esta tarefa não será reenviada automaticamente.')
    ctx.db.update(jobs).set({ resultJson: JSON.stringify({ starting: true }) }).where(condition).run()
    const run = runSchema.parse(await apifyJson('actors/apify~instagram-reel-scraper/runs?timeout=600', key, {
      username: [profile.url], resultsLimit: limit, includeDownloadedVideo: false
    })).data
    checkpoint = { runId: run.id }
    ctx.db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(condition).run()
  }
  let dataset: string | undefined
  for (let attempt = 0; attempt < 12; attempt++) {
    const run = runSchema.parse(await apifyJson(`actor-runs/${remoteId.parse(checkpoint.runId)}?waitForFinish=60`, key)).data
    if (run.status === 'SUCCEEDED') { dataset = run.defaultDatasetId; break }
    if (!['READY', 'RUNNING'].includes(run.status)) throw new AppError('invalid_input', `A busca Apify terminou em ${run.status}. Consulte o provedor e inicie uma nova busca.`)
  }
  if (!dataset) throw new AppError('internal', 'A busca ainda não terminou. A próxima tentativa consultará a mesma execução.')
  const items = z.array(z.unknown()).max(100).parse(await apifyJson(`datasets/${dataset}/items?clean=true&limit=${limit}`, key))
  let queued = 0
  let skipped = 0
  for (const item of items) {
    const parsed = reelSchema.safeParse(item)
    if (!parsed.success) { skipped++; continue }
    const reel = parsed.data
    let ref: ReturnType<typeof normalizeInstagramUrl>
    try { allowedUrl(reel.videoUrl); ref = normalizeInstagramUrl(reel.url) } catch { skipped++; continue }
    if (ref.kind === 'profile') { skipped++; continue }
    const post = addReelLink(ctx, job.workspaceId, profileId, ref.url)
    if (post.profileId !== profileId) { skipped++; continue }
    const timestamp = reel.timestamp && Number.isFinite(Date.parse(reel.timestamp)) ? new Date(reel.timestamp).toISOString() : null
    ctx.db.update(remotePosts).set({
      remoteId: reel.id ?? null, caption: reel.caption ?? null, postedAt: timestamp,
      views: count(reel.videoViewCount), likes: count(reel.likesCount), comments: count(reel.commentsCount),
      metricsSource: 'api', metricsUpdatedAt: ctx.clock().toISOString()
    }).where(and(eq(remotePosts.workspaceId, job.workspaceId), eq(remotePosts.id, post.id))).run()
    if (post.assetId && getAsset(ctx.db, job.workspaceId, post.assetId)) continue
    enqueue(ctx.db, {
      workspaceId: job.workspaceId, type: 'download_reel', payload: { postId: post.id, videoUrl: reel.videoUrl },
      label: `Baixar reel ${ref.code} de @${profile.username}`, idempotencyKey: `download:${job.workspaceId}:${job.id}:${post.id}`, maxAttempts: 3
    }, ctx.clock())
    queued++
  }
  if (!items.length || skipped === items.length) throw new AppError('invalid_input', 'Nenhum reel com vídeo disponível. O perfil pode estar privado, vazio ou bloqueado pelo provedor.')
  ctx.db.update(trackedProfiles).set({ lastSyncedAt: ctx.clock().toISOString() }).where(and(eq(trackedProfiles.workspaceId, job.workspaceId), eq(trackedProfiles.id, profileId))).run()
  if (notificationPreferences(ctx, job.workspaceId).completed) addNotification(ctx.db, { workspaceId: job.workspaceId, kind: 'info', title: `Busca de @${profile.username} concluída`, body: `${queued} downloads na fila; ${skipped} resultados indisponíveis. Acompanhe cada arquivo na Fila.` }, ctx.clock())
  return { ...checkpoint, queued, skipped }
}

export async function runReelDownload(ctx: Ctx, job: LeasedJob): Promise<unknown> {
  const { postId, videoUrl } = z.object({ postId: z.string(), videoUrl: z.string() }).parse(job.payload)
  const post = getRemotePost(ctx.db, job.workspaceId, postId)
  if (!post) throw new AppError('not_found', 'Reel não encontrado.')
  if (post.assetId && getAsset(ctx.db, job.workspaceId, post.assetId)) return { assetId: post.assetId }
  const dir = resolveInside(workspaceDir(ctx.dataRoot, job.workspaceId), 'downloads', job.id)
  const file = resolveInside(dir, `${post.id}.mp4`)
  await mkdir(dir, { recursive: true })
  try {
    // A previous worker may have stopped mid-stream. Restart only this job's temporary file.
    await rm(file, { force: true })
    await downloadVideo(videoUrl, file)
    const [result] = await importFiles(ctx, job.workspaceId, [file], { origin: 'ig_third_party', rightsNote: `Apify; origem: ${post.permalink}` })
    if (!result.assetId) throw new AppError('invalid_media', result.errors.join(' ') || 'Vídeo inválido.')
    ctx.db.transaction(() => {
      ctx.db.update(remotePosts).set({ assetId: result.assetId, durationMs: getAsset(ctx.db, job.workspaceId, result.assetId!)!.durationMs }).where(and(eq(remotePosts.workspaceId, job.workspaceId), eq(remotePosts.id, postId))).run()
    })
    return { assetId: result.assetId, status: result.status }
  } finally { await rm(file, { force: true }) }
}

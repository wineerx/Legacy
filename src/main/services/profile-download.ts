import { mkdir, rm, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { profileContentSource, type ProfileContentSource, type ImportProgress } from '@shared/ipc-contract'
import { normalizeSocialUrl } from '@shared/social-url'
import type { Ctx } from '../context'
import { jobs, remotePosts, trackedProfiles } from '../db/schema'
import { enqueue, type LeasedJob } from '../queue/queue'
import { getProfile } from '../repos/profiles'
import { addReelLink, getRemotePost } from '../repos/remote-posts'
import { getAsset } from '../repos/assets'
import { addNotification } from '../repos/notifications'
import { resolveInside, workspaceDir } from '../paths'
import { importFiles } from './library'
import {
  allowedUrl,
  apifyJson,
  downloadVideo,
  downloadPreview
} from './download-http'
import { getSetting, setSetting } from '../repos/settings'
import { probe } from '../media/probe'
import { mergeAudio } from '../media/ops'
import { getSecret, notificationPreferences } from './integrations'

const remoteId = z.string().regex(/^[a-zA-Z0-9]+$/)
const runSchema = z.object({
  data: z.object({
    id: remoteId,
    status: z.string(),
    defaultDatasetId: remoteId.optional()
  })
})
const count = (n: unknown) =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
export const reelSchema = z.object({
  url: z.string(),
  audioUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  displayUrl: z.string().optional(),
  type: z.string().optional(),
  videoDuration: z.number().optional(),
  id: z.string().optional(),
  caption: z.string().max(10000).optional(),
  timestamp: z.string().optional(),
  videoViewCount: z.unknown().optional(),
  likesCount: z.unknown().optional(),
  commentsCount: z.unknown().optional(),
  ownerProfilePicUrl: z.string().optional(), profilePicUrl: z.string().optional()
})

export function downloadConfigured(ctx: Ctx, ws: string): boolean {
  return Boolean(getSecret(ctx, ws, 'apifyToken'))
}
function token(ctx: Ctx, ws: string): string {
  const value = getSecret(ctx, ws, 'apifyToken')
  if (!value)
    throw new AppError(
      'invalid_input',
      'Cadastre a chave Apify na Visão geral ou configure APIFY_TOKEN no ambiente.'
    )
  return value
}

export function requestProfileDownload(
  ctx: Ctx,
  workspaceId: string,
  profileId: string,
  limit: number,
  discovery = false,
  source?: ProfileContentSource
) {
  const profile = getProfile(ctx.db, workspaceId, profileId)
  if (!profile) throw new AppError('not_found', 'Perfil não encontrado.')
  const contentSource = profileContentSource.parse(source ?? (discovery ? getSetting(ctx.db, workspaceId, `profileContentSource.${profileId}`) ?? 'posts' : 'reels'))
  if (profile.platform !== 'instagram' && contentSource !== 'posts' && discovery)
    throw new AppError('invalid_input', 'Reels e marcados estão disponíveis apenas para Instagram.')
  token(ctx, workspaceId)
  if (!Number.isInteger(limit) || limit < 1 || limit > (discovery ? 1000 : 100))
    throw new AppError(
      'invalid_input',
      discovery ? 'Escolha de 1 a 1000 posts.' : 'Escolha de 1 a 100 vídeos.'
    )
  const pending = ctx.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        eq(jobs.type, 'fetch_profile'),
        inArray(jobs.state, ['queued', 'running'])
      )
    )
    .all()
  const existing = pending.find(
    (j) => JSON.parse(j.payloadJson).profileId === profileId
  )
  if (existing)
    throw new AppError('duplicate', 'Já existe uma busca deste perfil na fila.')
  if (discovery) setSetting(ctx.db, workspaceId, `profileContentSource.${profileId}`, contentSource)
  return enqueue(
    ctx.db,
    {
      workspaceId,
      type: 'fetch_profile',
      payload: { profileId, limit, discovery, source: contentSource },
      label: `Carregar até ${limit} ${discovery ? ({ posts: 'posts', reels: 'reels', tagged: 'marcados', all: 'posts, reels e marcados' }[contentSource]) : 'reels'} de @${profile.username}`,
      maxAttempts: 3
    },
    ctx.clock()
  )
}

export function profileImportProgress(ctx: Ctx, ws: string, profileId: string) {
  if (!getProfile(ctx.db, ws, profileId))
    throw new AppError('not_found', 'Perfil não encontrado.')
  const job = ctx.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ws),
        eq(jobs.type, 'fetch_profile'),
        sql`json_extract(${jobs.payloadJson}, '$.profileId') = ${profileId}`
      )
    )
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(1)
    .get()
  if (!job) return null
  const checkpoint = job.resultJson ? JSON.parse(job.resultJson) : {}
  return {
    jobId: job.id,
    state: job.state,
    error: job.lastError,
    progress: (checkpoint.progress ?? null) as ImportProgress | null
  }
}

export async function fetchProfile(ctx: Ctx, job: LeasedJob): Promise<unknown> {
  const { profileId, limit, discovery, source } = z
    .object({
      profileId: z.string(),
      limit: z.number().int().min(1).max(1000),
      discovery: z.boolean().default(false),
      source: profileContentSource.default('posts')
    })
    .parse(job.payload)
  if (!discovery && limit > 100)
    throw new AppError(
      'invalid_input',
      'O download está limitado a 100 vídeos por busca.'
    )
  const profile = getProfile(ctx.db, job.workspaceId, profileId)
  if (!profile) throw new AppError('not_found', 'Perfil não encontrado.')
  const key = token(ctx, job.workspaceId)
  const condition = and(
    eq(jobs.workspaceId, job.workspaceId),
    eq(jobs.id, job.id)
  )
  const saved = ctx.db.select().from(jobs).where(condition).get()?.resultJson
  let checkpoint: {
    starting?: boolean
    runId?: string
    sourceRuns?: Record<string, { starting?: boolean; runId?: string }>
    progress?: ImportProgress
    avatarStarting?: boolean
    avatarRunId?: string
    avatarChecked?: boolean
    avatarError?: string
  } = saved ? JSON.parse(saved) : {}
  let accepted = 0
  let avatarAttempted = false
  let processed = 0,
    imported = 0,
    previewFailures = 0
  let total: number | null = null
  let skipped = 0
  let lastProgress = 0
  const saveProgress = (phase: ImportProgress['phase'], force = false) => {
    if (!force && Date.now() - lastProgress < 1000) return
    lastProgress = Date.now()
    checkpoint.progress = {
      phase,
      processed,
      total,
      imported,
      skipped,
      previewFailures,
      percent:
        total === null
          ? null
          : total === 0
            ? 0
            : Math.floor((processed / total) * 100)
    }
    ctx.db
      .update(jobs)
      .set({ resultJson: JSON.stringify(checkpoint) })
      .where(condition)
      .run()
  }
  saveProgress('searching', true)
  const sources = source === 'all' && discovery && profile.platform === 'instagram' ? ['posts', 'reels', 'tagged'] : [source]
  const batches: unknown[][] = []
  for (const currentSource of sources) {
    let sourceRun = checkpoint.sourceRuns?.[currentSource] ?? (source !== 'all' ? { starting: checkpoint.starting, runId: checkpoint.runId } : {})
    if (!sourceRun.runId) {
      if (sourceRun.starting)
        throw new AppError(
          'invalid_input',
          'A criação da execução Apify ficou sem confirmação. Confira o console Apify antes de iniciar uma nova busca; esta tarefa não será reenviada automaticamente.'
        )
      ctx.db
        .update(jobs)
        .set({ resultJson: JSON.stringify({ ...checkpoint, sourceRuns: { ...checkpoint.sourceRuns, [currentSource]: { ...sourceRun, starting: true } } }) })
        .where(condition)
        .run()
      const run = runSchema.parse(
        await apifyJson(
          profile.platform === 'tiktok' ? 'actors/clockworks~tiktok-profile-scraper/runs?timeout=600' : `actors/apify~instagram-${discovery ? 'scraper' : 'reel-scraper'}/runs?timeout=600`,
          key,
          profile.platform === 'tiktok' ? { profiles: [profile.username], resultsPerPage: limit, profileSorting: 'latest', shouldDownloadVideos: false, shouldDownloadCovers: false } : discovery
            ? {
                directUrls: [profile.url],
                resultsType: currentSource === 'tagged' ? 'mentions' : currentSource,
                resultsLimit: limit
              }
            : {
                username: [profile.url],
                resultsLimit: limit,
                includeDownloadedVideo: false
              }
        )
      ).data
      sourceRun = { starting: false, runId: run.id }
      checkpoint.sourceRuns = { ...checkpoint.sourceRuns, [currentSource]: sourceRun }
      if (source !== 'all') { checkpoint.starting = false; checkpoint.runId = run.id }
      ctx.db
        .update(jobs)
        .set({ resultJson: JSON.stringify(checkpoint) })
        .where(condition)
        .run()
    }
    let dataset: string | undefined
    for (let attempt = 0; attempt < 12; attempt++) {
      const run = runSchema.parse(
        await apifyJson(
          `actor-runs/${remoteId.parse(sourceRun.runId)}?waitForFinish=60`,
          key
        )
      ).data
      if (run.status === 'SUCCEEDED') {
        dataset = run.defaultDatasetId
        break
      }
      if (!['READY', 'RUNNING'].includes(run.status))
        throw new AppError(
          'invalid_input',
          `A busca Apify terminou em ${run.status}. Consulte o provedor e inicie uma nova busca.`
        )
    }
    if (!dataset)
      throw new AppError(
        'internal',
        'A busca ainda não terminou. A próxima tentativa consultará a mesma execução.'
      )
    const sourceItems: unknown[] = []
    for (let offset = 0; offset < limit; offset += 100) {
      const pageSize = Math.min(100, limit - offset)
      const page = z
        .array(z.unknown())
        .max(pageSize)
        .parse(
          await apifyJson(
            `datasets/${dataset}/items?clean=true&limit=${pageSize}&offset=${offset}`,
            key
          )
        )
      sourceItems.push(...page)
      if (page.length < pageSize) break
    }
    batches.push(sourceItems)
  }
  // Interleave sources so the total limit does not favor posts over Reels or tags.
  const items: unknown[] = source === 'all' ? [] : batches[0]
  const seen = new Set<string>()
  for (let index = 0; source === 'all' && items.length < limit && batches.some(batch => index < batch.length); index++) {
    for (const batch of batches) {
      if (index >= batch.length || items.length >= limit) continue
      const item = batch[index]
      const key = typeof item === 'object' && item !== null && 'url' in item ? String(item.url) : JSON.stringify(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  let queued = 0
  total = items.length
  saveProgress('importing', true)
  for (const item of items) {
    try {
      const parsed = reelSchema.safeParse(profile.platform === 'tiktok' ? tiktokItem(item) : item)
      if (!parsed.success) {
        skipped++
        continue
      }
      const reel = parsed.data
      let ref: ReturnType<typeof normalizeSocialUrl>
      try {
        if (reel.audioUrl) allowedUrl(reel.audioUrl)
        if (reel.videoUrl) allowedUrl(reel.videoUrl)
        else if (!discovery) throw new Error('No video')
        ref = normalizeSocialUrl(reel.url)
      } catch {
        skipped++
        continue
      }
      if (ref.kind === 'profile') {
        skipped++
        continue
      }
      accepted++
      const existing = ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, job.workspaceId), eq(remotePosts.profileId, profileId), reel.id ? eq(remotePosts.remoteId, reel.id) : eq(remotePosts.permalink, ref.url))).get()
      const post = existing ?? addReelLink(ctx, job.workspaceId, profileId, ref.url)
      if (post.profileId !== profileId) {
        skipped++
        continue
      }
      const timestamp =
        reel.timestamp && Number.isFinite(Date.parse(reel.timestamp))
          ? new Date(reel.timestamp).toISOString()
          : null
      ctx.db
        .update(remotePosts)
        .set({
          durationMs: reel.videoDuration !== undefined && Number.isFinite(reel.videoDuration) && reel.videoDuration >= 0 ? Math.round(reel.videoDuration * 1000) : post.durationMs,
          remoteId: reel.id ?? post.remoteId,
          caption: reel.caption ?? null,
          postedAt: timestamp,
          mediaProductType: reel.videoUrl
            ? 'VIDEO'
            : reel.type === 'Sidecar'
              ? 'CAROUSEL'
              : 'IMAGE',
          views: count(reel.videoViewCount),
          likes: count(reel.likesCount),
          comments: count(reel.commentsCount),
          metricsSource: 'api',
          metricsUpdatedAt: ctx.clock().toISOString()
        })
        .where(
          and(
            eq(remotePosts.workspaceId, job.workspaceId),
            eq(remotePosts.id, post.id)
          )
        )
        .run()
      setSetting(
        ctx.db,
        job.workspaceId,
        `remoteMedia.${post.id}`,
        JSON.stringify({
          videoUrl: reel.videoUrl ?? null,
          audioUrl: reel.audioUrl ?? null,
          type: reel.type ?? (reel.videoUrl ? 'Video' : 'Image')
        })
      )
      if (existing || post.metricsUpdatedAt) skipped++; else imported++
      const avatarUrl = reel.ownerProfilePicUrl ?? reel.profilePicUrl
      if (profile.platform === 'tiktok' && avatarUrl && !avatarAttempted && !getSetting(ctx.db, job.workspaceId, `profileAvatar.${profile.id}`)) {
        avatarAttempted = true
        const dir = resolveInside(workspaceDir(ctx.dataRoot, job.workspaceId), 'previews'); await mkdir(dir, { recursive: true })
        const path = resolveInside(dir, `profile-${profile.id}.jpg`)
        try { await downloadPreview(avatarUrl, path); setSetting(ctx.db, job.workspaceId, `profileAvatar.${profile.id}`, path) } catch { /* Optional avatar never fails the import. */ }
      }
      if (reel.displayUrl && !post.thumbnailPath) {
        const previewDir = resolveInside(
          workspaceDir(ctx.dataRoot, job.workspaceId),
          'previews'
        )
        await mkdir(previewDir, { recursive: true })
        const preview = resolveInside(previewDir, `${post.id}.jpg`)
        try {
          await downloadPreview(reel.displayUrl, preview)
          ctx.db
            .update(remotePosts)
            .set({
              thumbnailPath: preview,
              durationMs: reel.videoDuration
                ? Math.round(reel.videoDuration * 1000)
                : post.durationMs
            })
            .where(
              and(
                eq(remotePosts.workspaceId, job.workspaceId),
                eq(remotePosts.id, post.id)
              )
            )
            .run()
        } catch {
          previewFailures++ /* Keep metadata when preview is unavailable. */
        }
      }
      if (
        discovery ||
        (post.assetId && getAsset(ctx.db, job.workspaceId, post.assetId)) ||
        ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, job.workspaceId), eq(jobs.type, 'download_reel'), inArray(jobs.state, ['queued', 'running']))).all().some(j => JSON.parse(j.payloadJson).postId === post.id)
      )
        continue
      enqueue(
        ctx.db,
        {
          workspaceId: job.workspaceId,
          type: 'download_reel',
          payload: {
            postId: post.id,
            videoUrl: reel.videoUrl,
            audioUrl: reel.audioUrl,
            batchId: job.id
          },
          label: `Baixar reel ${ref.code} de @${profile.username}`,
          idempotencyKey: `download:${job.workspaceId}:${job.id}:${post.id}`,
          maxAttempts: 3
        },
        ctx.clock()
      )
      queued++
    } finally {
      processed++
      saveProgress('importing', processed === total)
    }
  }
  if (!items.length || !accepted)
    throw new AppError(
      'invalid_input',
      'Nenhum post disponível. O perfil pode estar privado, vazio ou bloqueado pelo provedor.'
    )
  // Posts need not contain the account photo; tagged posts belong to other authors.
  const cachedAvatar = getSetting(ctx.db, job.workspaceId, `profileAvatar.${profile.id}`)
  if (profile.platform === 'instagram' && (!cachedAvatar || !existsSync(cachedAvatar)) && !checkpoint.avatarChecked) {
    const persistAvatar = () => ctx.db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(condition).run()
    try {
      if (!checkpoint.avatarRunId) {
        if (checkpoint.avatarStarting) throw new Error('A consulta da foto ficou sem confirma\u00e7\u00e3o; confira a execu\u00e7\u00e3o na Apify.')
        checkpoint.avatarStarting = true
        persistAvatar()
        const run = runSchema.parse(await apifyJson('actors/apify~instagram-scraper/runs?timeout=600', key, {
          directUrls: [profile.url], resultsType: 'details', resultsLimit: 1
        })).data
        checkpoint.avatarRunId = run.id
        checkpoint.avatarStarting = false
        persistAvatar()
      }
      let avatarDataset: string | undefined
      for (let attempt = 0; attempt < 12; attempt++) {
        const run = runSchema.parse(await apifyJson(`actor-runs/${remoteId.parse(checkpoint.avatarRunId)}?waitForFinish=60`, key)).data
        if (run.status === 'SUCCEEDED') { avatarDataset = run.defaultDatasetId; break }
        if (!['READY', 'RUNNING'].includes(run.status)) throw new Error(`Consulta da foto terminou em ${run.status}.`)
      }
      if (!avatarDataset) throw new Error('A consulta da foto ainda n\u00e3o terminou.')
      const details = z.array(z.object({ username: z.string(), profilePicUrl: z.string().optional(), profilePicUrlHD: z.string().optional() })).parse(
        await apifyJson(`datasets/${avatarDataset}/items?clean=true&limit=1`, key)
      ).find(p => p.username.toLowerCase() === profile.username.toLowerCase())
      const avatarUrl = details?.profilePicUrlHD ?? details?.profilePicUrl
      if (!avatarUrl) throw new Error('O provedor n\u00e3o retornou a foto desta conta.')
      const dir = resolveInside(workspaceDir(ctx.dataRoot, job.workspaceId), 'previews')
      await mkdir(dir, { recursive: true })
      const path = resolveInside(dir, `profile-${profile.id}.jpg`)
      await downloadPreview(avatarUrl, path)
      setSetting(ctx.db, job.workspaceId, `profileAvatar.${profile.id}`, path)
      checkpoint.avatarChecked = true
      delete checkpoint.avatarError
    } catch (error) {
      checkpoint.avatarError = error instanceof Error ? error.message : 'Falha ao carregar foto do perfil.'
      // Keep imported posts; a future refresh retries the optional photo.
      checkpoint.avatarChecked = true
    }
    persistAvatar()
  }
  saveProgress('done', true)
  ctx.db
    .update(trackedProfiles)
    .set({ lastSyncedAt: ctx.clock().toISOString() })
    .where(
      and(
        eq(trackedProfiles.workspaceId, job.workspaceId),
        eq(trackedProfiles.id, profileId)
      )
    )
    .run()
  if (notificationPreferences(ctx, job.workspaceId).completed)
    addNotification(
      ctx.db,
      {
        workspaceId: job.workspaceId,
        kind: 'info',
        title: `Busca de @${profile.username} concluída`,
        body: `${queued} downloads na fila; ${skipped} resultados já conhecidos ou ignorados. Acompanhe cada arquivo na Fila.`,
        actionJson: JSON.stringify({
          type: 'open_queue',
          jobId: job.id,
          groupId: job.id,
          category: 'download'
        })
      },
      ctx.clock()
    )
  return { ...checkpoint, queued, skipped }
}

export function requestSelectedDownloads(
  ctx: Ctx,
  ws: string,
  postIds: string[]
) {
  const posts = postIds.map((id) => getRemotePost(ctx.db, ws, id))
  if (posts.some((p) => !p))
    throw new AppError('not_found', 'Post não encontrado neste workspace.')
  const media = posts.map((p) => ({
    post: p!,
    url: JSON.parse(getSetting(ctx.db, ws, `remoteMedia.${p!.id}`) ?? '{}')
      .videoUrl as string | undefined,
    audioUrl: JSON.parse(getSetting(ctx.db, ws, `remoteMedia.${p!.id}`) ?? '{}')
      .audioUrl as string | undefined
  }))
  for (const p of media)
    if (!p.post.assetId) {
      if (!p.url)
        throw new AppError(
          'invalid_input',
          'Selecione somente vídeos com URL disponível.'
        )
      allowedUrl(p.url)
      if (p.audioUrl) allowedUrl(p.audioUrl)
    }
  const batchId = randomUUID()
  return ctx.db.transaction(() =>
    media
      .filter((p) => !p.post.assetId && !ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'download_reel'), inArray(jobs.state, ['queued', 'running']))).all().some(j => JSON.parse(j.payloadJson).postId === p.post.id))
      .map((p) =>
        enqueue(
          ctx.db,
          {
            workspaceId: ws,
            type: 'download_reel',
            payload: {
              postId: p.post.id,
              videoUrl: p.url,
              audioUrl: p.audioUrl,
              batchId
            },
            label: `Baixar vídeo selecionado ${p.post.id.slice(0, 8)}`,
            idempotencyKey: `selected:${ws}:${p.post.id}:${ctx.clock().getTime()}`,
            maxAttempts: 3
          },
          ctx.clock()
        )
      )
  )
}

export function selectedAssets(
  ctx: Ctx,
  ws: string,
  postIds: string[]
): string[] {
  return postIds.map((id) => {
    const post = getRemotePost(ctx.db, ws, id)
    if (!post?.assetId || !getAsset(ctx.db, ws, post.assetId))
      throw new AppError(
        'invalid_input',
        'Baixe os vídeos selecionados antes de editar o lote.'
      )
    return post.assetId
  })
}

export async function runReelDownload(
  ctx: Ctx,
  job: LeasedJob
): Promise<unknown> {
  const { postId, videoUrl, audioUrl } = z
    .object({
      postId: z.string(),
      videoUrl: z.string(),
      audioUrl: z.string().nullish()
    })
    .parse(job.payload)
  const post = getRemotePost(ctx.db, job.workspaceId, postId)
  if (!post) throw new AppError('not_found', 'Reel não encontrado.')
  if (post.assetId && getAsset(ctx.db, job.workspaceId, post.assetId))
    return { assetId: post.assetId }
  const dir = resolveInside(
    workspaceDir(ctx.dataRoot, job.workspaceId),
    'downloads',
    job.id
  )
  const file = resolveInside(dir, `${post.id}.mp4`)
  await mkdir(dir, { recursive: true })
  try {
    // A previous worker may have stopped mid-stream. Restart only this job's temporary file.
    await rm(file, { force: true })
    await downloadVideo(videoUrl, file)
    // Never download a manifest with arbitrary remote URLs through FFmpeg.
    // Both tracks go through the same bounded, CDN-only HTTP downloader first.
    if (audioUrl && !(await probe(file, true)).audioCodec) {
      const audio = resolveInside(dir, 'audio.mp4')
      const merged = resolveInside(dir, 'merged.mp4')
      try {
        await downloadVideo(audioUrl, audio)
        await mergeAudio(file, audio, merged)
        await rm(file, { force: true })
        await rename(merged, file)
      } finally {
        await rm(audio, { force: true })
        await rm(merged, { force: true })
      }
    }
    const [result] = await importFiles(ctx, job.workspaceId, [file], {
      origin: getProfile(ctx.db, job.workspaceId, post.profileId)?.platform === 'tiktok' ? 'tiktok_third_party' : 'ig_third_party',
      rightsNote: `Apify; origem: ${post.permalink}`
    })
    if (!result.assetId)
      throw new AppError(
        'invalid_media',
        result.errors.join(' ') || 'Vídeo inválido.'
      )
    ctx.db.transaction(() => {
      ctx.db
        .update(remotePosts)
        .set({
          assetId: result.assetId,
          durationMs: getAsset(ctx.db, job.workspaceId, result.assetId!)!
            .durationMs
        })
        .where(
          and(
            eq(remotePosts.workspaceId, job.workspaceId),
            eq(remotePosts.id, postId)
          )
        )
        .run()
    })
    return { assetId: result.assetId, status: result.status }
  } finally {
    await rm(file, { force: true })
  }
}

function tiktokItem(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const p = item as Record<string, any>
  return { id: p.id, url: p.webVideoUrl, caption: p.text, timestamp: p.createTimeISO ?? (typeof p.createTime === 'number' && Number.isFinite(p.createTime) ? new Date(p.createTime * 1000).toISOString() : undefined), videoUrl: p.videoMeta?.downloadAddr ?? p.videoMeta?.originalDownloadAddr ?? p.mediaUrls?.[0], displayUrl: p.videoMeta?.coverUrl ?? p.videoMeta?.originalCoverUrl, ownerProfilePicUrl: p.authorMeta?.avatar, videoDuration: p.videoMeta?.duration, videoViewCount: p.playCount, likesCount: p.diggCount, commentsCount: p.commentCount, type: 'Video' }
}

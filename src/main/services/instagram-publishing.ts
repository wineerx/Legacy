import { request } from 'node:https'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, eq, desc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { jobs, remotePosts } from '../db/schema'
import { getAsset } from '../repos/assets'
import { getRemotePost } from '../repos/remote-posts'
import { getSetting, setSetting } from '../repos/settings'
import { getSecret, requireWorkspace, saveSecret, type SecretVault } from './integrations'
import { enqueue, type LeasedJob } from '../queue/queue'
import { repostWarnings } from './repost-check'
import { listVersions } from '../repos/assets'
import { history, recordPublication } from './publication-history'

import { preparePublishCopy, type PreparedCopy } from '../media/publish-prep'
import { publishTmpDir } from './publish-tmp'
import { defaultMediaHost, exposeForJob, releaseExpired, releaseExposure, SHARE_TTL_MS } from './media-host/registry'
import type { MediaHost } from './media-host/types'

const numericId = z.string().regex(/^\d+$/)
const accountSchema = z.object({ id: numericId, username: z.string().min(1), revision: z.string(), validatedAt: z.string() })
export class InstagramApiError extends AppError {
  constructor(public status: number, public apiCode: number) {
    super('invalid_input', apiCode === 190 ? 'Token Instagram inválido ou expirado. Gere um token Instagram User na Meta e reconecte em Contas.' : apiCode === 10 || apiCode === 200 ? 'Permissão recusada. Autorize instagram_business_basic e instagram_business_content_publish; em modo de teste a conta deve aceitar o convite do app.' : apiCode === 100 ? 'Parâmetro recusado. Confira a conta profissional, a URL pública do vídeo e a validade do link; atualize a grade antes de reagendar.' : `Instagram recusou a operação (HTTP ${status}, código ${apiCode || 'indisponível'}). Confira token, permissões e limite de publicação.`)
  }
}
export async function instagramJson(path: string, token: string, body?: Record<string, string>): Promise<unknown> {
  if (!/^(me|\d+)(\/(media|media_publish))?(\?fields=[a-z_,]+)?$/.test(path)) throw new AppError('invalid_input', 'Consulta Instagram inválida.')
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : undefined
    const req = request(`https://graph.instagram.com/v25.0/${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''; res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk; if (text.length > 1024 * 1024) res.destroy() })
      res.on('error', () => reject(new AppError('internal', 'Resposta Instagram interrompida.')))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(text)
          if ((res.statusCode ?? 500) >= 400 || parsed.error) return reject(new InstagramApiError(res.statusCode ?? 500, Number(parsed.error?.code) || 0))
          resolve(parsed)
        } catch { reject(new AppError('internal', 'Resposta Instagram inválida.')) }
      })
    })
    req.on('error', () => reject(new AppError('internal', 'Não foi possível confirmar a resposta do Instagram.'))); req.end(data)
  })
}
export function instagramAccount(ctx: Ctx, ws: string) {
  requireWorkspace(ctx, ws)
  const saved = getSetting(ctx.db, ws, 'instagramAccount')
  const value = saved ? accountSchema.safeParse(JSON.parse(saved)) : null
  return value?.success && getSecret(ctx, ws, 'instagramToken') ? value.data : null
}
export async function connectInstagram(ctx: Ctx, vault: SecretVault, ws: string, token: string, requestApi = instagramJson) {
  requireWorkspace(ctx, ws)
  const raw = await requestApi('me?fields=user_id,username', token) as { data?: unknown[] }
  const identity = z.object({ user_id: numericId, username: z.string().min(1).max(80) }).safeParse(raw.data?.[0] ?? raw)
  if (!identity.success) throw new AppError('invalid_input', 'O token não retornou uma conta profissional Instagram. Use Instagram User Access Token com Instagram Login; chave secreta, Client Token e token Facebook não servem para esta conexão.')
  const data = { id: identity.data.user_id, username: identity.data.username }
  // Querying account identity does not prove publish permission; the API enforces it at execution.
  const previous = instagramAccount(ctx, ws)
  const account = { ...data, revision: previous?.id === data.id ? previous.revision : randomUUID(), validatedAt: ctx.clock().toISOString() }
  ctx.db.transaction(() => { saveSecret(ctx, vault, ws, 'instagramToken', token); setSetting(ctx.db, ws, 'instagramAccount', JSON.stringify(account)) })
  return account
}
export async function verifyInstagram(ctx: Ctx, vault: SecretVault, ws: string, requestApi = instagramJson) {
  requireWorkspace(ctx, ws)
  const token = getSecret(ctx, ws, 'instagramToken')
  if (!token) throw new AppError('invalid_input', 'Conecte uma conta primeiro.')
  return connectInstagram(ctx, vault, ws, token, requestApi)
}
export function disconnectInstagram(ctx: Ctx, vault: SecretVault, ws: string) {
  ctx.db.transaction(() => { saveSecret(ctx, vault, ws, 'instagramToken', ''); setSetting(ctx.db, ws, 'instagramAccount', '') })
}
export function scheduleInstagram(ctx: Ctx, ws: string, input: { postIds: string[]; firstAt: string; intervalMin: number; caption?: string; captions?: Record<string,string>; cleanupAfterPublish?: boolean; allowRepost?: boolean; versionIds?: Record<string,string> }) {
  const account = instagramAccount(ctx, ws)
  if (!account) throw new AppError('invalid_input', 'Conecte uma conta profissional Instagram em Contas antes de programar.')
  const first = new Date(input.firstAt)
  const last = first.getTime() + (new Set(input.postIds).size-1)*input.intervalMin*60000
  if (!Number.isFinite(first.getTime()) || !Number.isInteger(input.intervalMin) || input.intervalMin < 15 || first.getTime() < ctx.clock().getTime() + 60_000 || last > ctx.clock().getTime() + 90 * 86400_000) throw new AppError('invalid_input', 'Escolha entre um minuto e 90 dias no futuro para todo o lote.')
  const posts = [...new Set(input.postIds)].map(id => {
    const post = getRemotePost(ctx.db, ws, id)
    if (!post) throw new AppError('not_found', 'Post não encontrado neste workspace.')
    if (!post.assetId) throw new AppError('invalid_input', 'Baixe o vídeo antes de agendar. O Instagram publica a cópia local.')
    const url = JSON.parse(getSetting(ctx.db, ws, `remoteMedia.${id}`) ?? '{}').videoUrl
    const caption = input.captions?.[id] ?? input.caption ?? post.caption ?? ''
    if (caption.length > 2200) throw new AppError('invalid_input', 'Edite a legenda: o limite é de 2200 caracteres.')
    return { postId: id, videoUrl: url, caption, localAssetId: post.assetId }
  })
  const batchId = randomUUID()
  return ctx.db.transaction(() => {
    const repeated = posts.map((post, i) => ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.idempotencyKey, `publish:${ws}:${account.id}:${post.postId}:${new Date(first.getTime() + i * input.intervalMin * 60000).toISOString()}`))).get())
    if (repeated.every(Boolean)) return repeated.map(r => ({ ...r!, type: 'publish_instagram' as const }))
    if (!input.allowRepost && repostWarnings(ctx, ws, account.id, { postIds: input.postIds }).length) throw new AppError('duplicate', 'Possível repostagem nesta conta. Revise o aviso e confirme antes de agendar novamente.')
    return posts.map((post, i) => {
    const runAt = new Date(first.getTime() + i * input.intervalMin * 60_000)
    return enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: `Publicar reel em @${account.username}`, payload: { ...post, username: account.username, accountId: account.id, accountRevision: account.revision, cleanupAfterPublish: input.cleanupAfterPublish ?? false, versionId: input.versionIds?.[post.localAssetId], allowRepost: input.allowRepost ?? false, batchId }, runAt, maxAttempts: 24, idempotencyKey: `publish:${ws}:${account.id}:${post.postId}:${runAt.toISOString()}` }, ctx.clock())
  }) })
}
export function scheduleComposition(ctx: Ctx, ws: string, input: { assetIds: string[]; accountId: string; accountRevision: string; firstAt: string; intervalMin: number; captions: Record<string,string>; cleanupAfterPublish: boolean; versionIds?: Record<string,string>; allowRepost?: boolean }) {
 for (const [assetId, versionId] of Object.entries(input.versionIds ?? {})) { if (!listVersions(ctx.db, ws, assetId).some(v => v.id === versionId && v.kind === 'banner') && !ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'apply_banner'), inArray(jobs.state, ['queued', 'running']))).all().some(j => {const p = JSON.parse(j.payloadJson);return p.versionId === versionId && p.assetId === assetId})) throw new AppError('invalid_input', 'Versão editada inválida neste workspace.') }
 const account=instagramAccount(ctx,ws)
 if (!account || account.id!==input.accountId || account.revision!==input.accountRevision) throw new AppError('invalid_input','O destino mudou. Atualize e revise a conta antes de confirmar.')
 const mapped=[...new Set(input.assetIds)].map(assetId=>{
  if(!getAsset(ctx.db,ws,assetId)) throw new AppError('not_found','Vídeo não encontrado neste workspace.')
  const post=ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId,ws),eq(remotePosts.assetId,assetId))).orderBy(desc(remotePosts.metricsUpdatedAt)).get()
  if(!post) throw new AppError('invalid_input','Este vídeo local não possui URL pública de origem para o Instagram. Importe um reel pela grade de Perfis.')
  return {postId:post.id,caption:input.captions[assetId] ?? ''}
 })
 return scheduleInstagram(ctx,ws,{postIds:mapped.map(p=>p.postId),captions:Object.fromEntries(mapped.map(p=>[p.postId,p.caption])),firstAt:input.firstAt,intervalMin:input.intervalMin,cleanupAfterPublish:input.cleanupAfterPublish,allowRepost:input.allowRepost,versionIds:input.versionIds})
}
export class InstagramPending extends AppError { constructor(public retryAfterMs = 60_000) { super('internal', 'O Instagram ainda está preparando o vídeo. Nova consulta em instantes.') } }
export type PublishDeps = { host: MediaHost; prepare: (input: string, tmpDir: string) => Promise<PreparedCopy> }
export const defaultPublishDeps = (): PublishDeps => ({ host: defaultMediaHost(), prepare: preparePublishCopy })
const PUBLISH_FAILED = 'O Instagram não conseguiu processar o vídeo enviado pelo link temporário.'
const quietly = (p: Promise<void>) => p.catch(() => {})

export async function publishInstagram(ctx: Ctx, job: LeasedJob, requestApi = instagramJson, deps: PublishDeps = defaultPublishDeps()) {
  const payload = z.object({ postId: z.string(), localAssetId: z.string().nullish(), versionId: z.string().optional(), allowRepost: z.boolean().default(false), caption: z.string().max(2200), accountId: numericId, accountRevision: z.string(), cleanupAfterPublish: z.boolean().default(false) }).parse(job.payload)
  // Cleanup of stale exposures (any job) must never fail this publication.
  await quietly(releaseExpired())
  const recorded = history(ctx, job.workspaceId).find(r => r.jobId === job.id)
  if (recorded) return { mediaId: recorded.mediaId, confirmedPublished: true, cleanupState: recorded.cleanupState }
  const account = instagramAccount(ctx, job.workspaceId)
  if (!account || account.id !== payload.accountId || account.revision !== payload.accountRevision) throw new AppError('invalid_input', 'A conta conectada mudou. Recrie o agendamento após revisar o destino.')
  const ws = job.workspaceId
  const assetId = payload.localAssetId ?? (payload.postId ? getRemotePost(ctx.db, ws, payload.postId)?.assetId : null)
  const asset = assetId ? getAsset(ctx.db, ws, assetId) : null
  const token = getSecret(ctx, ws, 'instagramToken')!
  const where = and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))
  const checkpoint = JSON.parse(ctx.db.select().from(jobs).where(where).get()?.resultJson ?? '{}') as { creating?: boolean; containerId?: string; publishing?: boolean; mediaId?: string; hostId?: string; exposedAt?: string; failedContainers?: { id: string; status: string; at: string }[] }
  const save = () => ctx.db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(where).run()
  const confirmed = async () => {
    await quietly(releaseExposure(job.id))
    const row = await recordPublication(ctx, { workspaceId: ws, jobId: job.id, accountId: account.id, username: account.username, postId: payload.postId, mediaId: checkpoint.mediaId, cleanup: payload.cleanupAfterPublish, cleanupAssetId: asset?.id ?? null })
    return { ...checkpoint, confirmedPublished: true, cleanupState: row.cleanupState }
  }
  // Retry after ERROR must create a fresh container; the failed one stays ERROR forever.
  const failContainer = async (code?: string, terminal = 'ERROR'): Promise<never> => {
    const legacy = !checkpoint.hostId
    if (checkpoint.containerId) checkpoint.failedContainers = [...(checkpoint.failedContainers ?? []), { id: checkpoint.containerId, status: terminal, at: ctx.clock().toISOString() }].slice(-24)
    await quietly(releaseExposure(job.id))
    delete checkpoint.containerId; delete checkpoint.exposedAt; checkpoint.creating = false; save()
    if (legacy && (terminal === 'ERROR' || terminal === 'EXPIRED')) throw new InstagramPending(15_000)
    throw new AppError('invalid_input', `${PUBLISH_FAILED}${code ? ` (código Meta ${code})` : ''}`)
  }
  if (checkpoint.mediaId) return confirmed()
  if (!checkpoint.containerId) {
    if (!payload.allowRepost && repostWarnings(ctx, ws, account.id, { postIds: [payload.postId] }).some(r => r.reason.includes('já foi publicado'))) throw new AppError('duplicate', 'Este vídeo foi publicado nesta conta depois do agendamento. Reagende pela Biblioteca e confirme a repostagem intencional.')
    if (checkpoint.creating) throw new AppError('invalid_input', 'Criação do vídeo sem confirmação. Confira o Instagram antes de recriar a tarefa.')
    if (!asset || !existsSync(asset.filePath)) throw new AppError('invalid_input', 'Baixe ou importe o vídeo antes de publicar. O Instagram publica a cópia local.')
    const tmpDir = publishTmpDir(ctx, ws)
    const version = payload.versionId ? listVersions(ctx.db, ws, asset.id).find(v => v.id === payload.versionId && v.kind === 'banner') : null
    if (payload.versionId && !version) throw new AppError('invalid_input', 'Versão editada não encontrada neste workspace.')
    const videoUrl = await exposeForJob(job.id, () => deps.prepare(version?.filePath ?? asset.filePath, tmpDir), deps.host)
    checkpoint.creating = true; checkpoint.hostId = deps.host.id; checkpoint.exposedAt = ctx.clock().toISOString(); save()
    let response: unknown
    try { response = await requestApi(`${account.id}/media`, token, { media_type: 'REELS', video_url: videoUrl, caption: payload.caption, share_to_feed: 'true', ...(payload.versionId ? { thumb_offset: '0' } : {}) }) }
    catch (e) { if (e instanceof InstagramApiError && e.status < 500) { checkpoint.creating = false; save(); await quietly(releaseExposure(job.id)) } throw e }
    checkpoint.containerId = z.object({ id: numericId }).parse(response).id; save()
  }
  const status = z.object({ status_code: z.string(), status: z.string().optional() }).parse(await requestApi(`${numericId.parse(checkpoint.containerId)}?fields=status_code,status`, token))
  if (status.status_code === 'PUBLISHED') return confirmed()
  if (checkpoint.publishing) {
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw new AppError('invalid_input', `Publicação sem confirmação; a Meta informou ${status.status_code}. Confira a conta antes de tentar novamente. O contêiner foi preservado.`)
    throw new InstagramPending(15_000)
  }
  if (status.status_code === 'IN_PROGRESS') {
    const started = checkpoint.exposedAt ? new Date(checkpoint.exposedAt).getTime() : ctx.clock().getTime()
    if (ctx.clock().getTime() - started > SHARE_TTL_MS) return failContainer()
    throw new InstagramPending(15_000)
  }
  // `status` carries Meta's subcode (e.g. "Error: 2207026"); it identifies the cause in the error reference.
  if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') return failContainer(status.status?.match(/\d{4,}/)?.[0], status.status_code)
  if (status.status_code !== 'FINISHED') throw new AppError('invalid_input', 'Estado de preparação desconhecido. A tarefa preservou o contêiner para revisão.')
  await quietly(releaseExposure(job.id))
  checkpoint.publishing = true; save()
  let response: unknown
  try { response = await requestApi(`${account.id}/media_publish`, token, { creation_id: checkpoint.containerId }) }
  catch (e) { if (e instanceof InstagramApiError && e.status < 500) { checkpoint.publishing = false; save() } throw e }
  checkpoint.mediaId = z.object({ id: numericId }).parse(response).id; save(); return confirmed()
}

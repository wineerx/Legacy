import { request } from 'node:https'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { jobs } from '../db/schema'
import { getRemotePost } from '../repos/remote-posts'
import { getSetting, setSetting } from '../repos/settings'
import { getSecret, requireWorkspace, saveSecret, type SecretVault } from './integrations'
import { allowedUrl } from './download-http'
import { enqueue, type LeasedJob } from '../queue/queue'

const numericId = z.string().regex(/^\d+$/)
const accountSchema = z.object({ id: numericId, username: z.string().min(1), revision: z.string(), validatedAt: z.string() })
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
          if ((res.statusCode ?? 500) >= 400 || parsed.error) return reject(new AppError('invalid_input', `Instagram recusou a operação (HTTP ${res.statusCode}, código ${Number(parsed.error?.code) || 'indisponível'}). Verifique permissões, validade do token, vídeo e limite de publicação.`))
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
  const data = z.object({ id: numericId, username: z.string().min(1).max(80) }).parse(await requestApi('me?fields=id,username', token))
  // Querying account identity does not prove publish permission; the API enforces it at execution.
  const account = { ...data, revision: randomUUID(), validatedAt: ctx.clock().toISOString() }
  ctx.db.transaction(() => { saveSecret(ctx, vault, ws, 'instagramToken', token); setSetting(ctx.db, ws, 'instagramAccount', JSON.stringify(account)) })
  return account
}
export function disconnectInstagram(ctx: Ctx, vault: SecretVault, ws: string) {
  ctx.db.transaction(() => { saveSecret(ctx, vault, ws, 'instagramToken', ''); setSetting(ctx.db, ws, 'instagramAccount', '') })
}
export function scheduleInstagram(ctx: Ctx, ws: string, input: { postIds: string[]; firstAt: string; intervalMin: number; caption?: string }) {
  const account = instagramAccount(ctx, ws)
  if (!account) throw new AppError('invalid_input', 'Conecte uma conta profissional Instagram em Contas antes de programar.')
  const first = new Date(input.firstAt)
  if (first.getTime() < ctx.clock().getTime() + 60_000 || first.getTime() > ctx.clock().getTime() + 90 * 86400_000) throw new AppError('invalid_input', 'Escolha entre um minuto e 90 dias no futuro.')
  const posts = [...new Set(input.postIds)].map(id => {
    const post = getRemotePost(ctx.db, ws, id)
    if (!post) throw new AppError('not_found', 'Post não encontrado neste workspace.')
    const url = JSON.parse(getSetting(ctx.db, ws, `remoteMedia.${id}`) ?? '{}').videoUrl
    if (!url) throw new AppError('invalid_input', 'Este post não possui URL de vídeo. Carregue a grade novamente.')
    allowedUrl(url)
    const caption = input.caption ?? post.caption ?? ''
    if (caption.length > 2200) throw new AppError('invalid_input', 'Edite a legenda: o limite é de 2200 caracteres.')
    return { postId: id, videoUrl: url, caption }
  })
  return ctx.db.transaction(() => posts.map((post, i) => {
    const runAt = new Date(first.getTime() + i * input.intervalMin * 60_000)
    return enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: `Publicar reel em @${account.username}`, payload: { ...post, accountId: account.id, accountRevision: account.revision }, runAt, maxAttempts: 6, idempotencyKey: `publish:${ws}:${account.id}:${post.postId}:${runAt.toISOString()}` }, ctx.clock())
  }))
}
export class InstagramPending extends AppError { retryAfterMs = 60_000; constructor() { super('internal', 'O Instagram ainda está preparando o vídeo. Nova consulta em um minuto.') } }
export async function publishInstagram(ctx: Ctx, job: LeasedJob, requestApi = instagramJson) {
  const payload = z.object({ postId: z.string(), videoUrl: z.string(), caption: z.string().max(2200), accountId: numericId, accountRevision: z.string() }).parse(job.payload)
  const account = instagramAccount(ctx, job.workspaceId)
  if (!account || account.id !== payload.accountId || account.revision !== payload.accountRevision) throw new AppError('invalid_input', 'A conta conectada mudou. Recrie o agendamento após revisar o destino.')
  if (!getRemotePost(ctx.db, job.workspaceId, payload.postId)) throw new AppError('not_found', 'Post de origem removido.')
  allowedUrl(payload.videoUrl)
  const token = getSecret(ctx, job.workspaceId, 'instagramToken')!
  const where = and(eq(jobs.workspaceId, job.workspaceId), eq(jobs.id, job.id))
  const checkpoint = JSON.parse(ctx.db.select().from(jobs).where(where).get()?.resultJson ?? '{}') as { creating?: boolean; containerId?: string; publishing?: boolean; mediaId?: string }
  const save = () => ctx.db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(where).run()
  if (checkpoint.mediaId) return checkpoint
  if (!checkpoint.containerId) {
    if (checkpoint.creating) throw new AppError('invalid_input', 'Criação do vídeo sem confirmação. Confira o Instagram antes de recriar a tarefa.')
    checkpoint.creating = true; save()
    const container = z.object({ id: numericId }).parse(await requestApi(`${account.id}/media`, token, { media_type: 'REELS', video_url: payload.videoUrl, caption: payload.caption, share_to_feed: 'true' }))
    checkpoint.containerId = container.id; save()
  }
  const status = z.object({ status_code: z.string() }).parse(await requestApi(`${numericId.parse(checkpoint.containerId)}?fields=status_code`, token))
  if (status.status_code === 'PUBLISHED') return { ...checkpoint, confirmedPublished: true }
  if (checkpoint.publishing) throw new AppError('invalid_input', 'Publicação sem confirmação. Confira a conta; esta tarefa não enviará o vídeo novamente.')
  if (status.status_code === 'IN_PROGRESS') throw new InstagramPending()
  if (status.status_code !== 'FINISHED') throw new AppError('invalid_input', `O Instagram encerrou a preparação em ${status.status_code}. O link pode ter expirado ou o vídeo ser incompatível.`)
  checkpoint.publishing = true; save()
  const published = z.object({ id: numericId }).parse(await requestApi(`${account.id}/media_publish`, token, { creation_id: checkpoint.containerId }))
  checkpoint.mediaId = published.id; save(); return checkpoint
}

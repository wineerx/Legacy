import { diagnosticRequest as request, diagnosticResponse, rememberDiagnosticSecret, recordDiagnostic } from '../diagnostics'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { catalogAudioChoice, sameAudio, DEFAULT_AUDIO_VOLUME, DEFAULT_VIDEO_VOLUME, type CatalogAudioChoice } from '@shared/catalog-audio'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { jobs, remotePosts, destinationAccounts, publicationHistory, publicationContainerItems } from '../db/schema'
import { getAsset } from '../repos/assets'
import { getRemotePost } from '../repos/remote-posts'
import { getSetting, setSetting } from '../repos/settings'
import { getSecret, requireWorkspace, saveSecret, type SecretVault } from './integrations'
import { enqueue, ownedJob, traceLease, type LeasedJob } from '../queue/queue'
import { pipelineConfig } from '../pipeline-config'
import { providerCooldown, providerSucceeded, retryAfterMs } from './provider-limiter'
import { materializeVersion } from './versions'
import { fetchQuota, assertPublicationQuota } from './instagram-quota'
import { repostWarnings } from './repost-check'
import { listVersions } from '../repos/assets'
import { history, recordPublication } from './publication-history'
import { scheduleContainerIntents } from './publication-containers'
import { assertNewPublicationAllowed, ContainerHeld } from './container-control'

import { preparePublishCopy, type PreparedCopy } from '../media/publish-prep'
import { publishTmpDir } from './publish-tmp'
import { defaultMediaHost, exposeForJob, releaseExpired, releaseExposure, SHARE_TTL_MS, ExposureCapacityError } from './media-host/registry'
import type { MediaHost } from './media-host/types'

const numericId = z.string().regex(/^\d+$/)
const accountSchema = z.object({ id: numericId, username: z.string().min(1), revision: z.string(), validatedAt: z.string() })
export type AuthKind = 'instagram_login' | 'facebook_login'
export class InstagramApiError extends AppError {
  constructor(public status: number, public apiCode: number, public retryAfterMs?: number, public apiSubcode?: number, public login: AuthKind = 'instagram_login') {
    if (status === 400 && apiCode === 9 && apiSubcode === 2207042) {
      super('internal', 'Instagram · Limite de publicações da conta atingido. Publicação adiada automaticamente.')
      return
    }
    const transient=status===429 || status>=500 || [4,17,32,613,80002].includes(apiCode)
    if (!transient && login === 'facebook_login') {
      super('invalid_input', apiCode === 190 ? 'Token Facebook inválido ou expirado. Entre com Facebook novamente em Contas.' : apiCode === 10 || apiCode === 200 || apiCode === 514 ? `Permissão recusada (código ${apiCode}). Autorize instagram_basic, instagram_content_publish, pages_show_list e pages_read_engagement, com a conta profissional vinculada a uma Página.` : apiCode === 100 ? 'Parâmetro recusado. Confira a conta profissional, a música escolhida e se o vídeo atende às especificações de Reels.' : `Instagram recusou a operação (HTTP ${status}, código ${apiCode || 'indisponível'}). Confira token, permissões e limite de publicação.`)
      return
    }
    super(transient?'internal':'invalid_input', transient ? `Instagram temporariamente indisponível ou limitado (HTTP ${status}, código ${apiCode || 'indisponível'}). O checkpoint foi preservado para retentativa segura.` : apiCode === 190 ? 'Token Instagram inválido ou expirado. Gere um token Instagram User na Meta e reconecte em Contas.' : apiCode === 10 || apiCode === 200 ? 'Permissão recusada. Autorize instagram_business_basic e instagram_business_content_publish; em modo de teste a conta deve aceitar o convite do app.' : apiCode === 100 ? 'Parâmetro recusado. Confira a conta profissional e se o vídeo atende às especificações de Reels.' : `Instagram recusou a operação (HTTP ${status}, código ${apiCode || 'indisponível'}). Confira token, permissões e limite de publicação.`)
  }
  get publicationLimited() { return this.status === 400 && this.apiCode === 9 && this.apiSubcode === 2207042 }
  get retryable() { return this.publicationLimited || this.status === 429 || this.status >= 500 || [4,17,32,613,80002].includes(this.apiCode) }
}
const publishingPath = /^(me|\d+)(\/(media|media_publish|content_publishing_limit))?(\?fields=[a-z_,]+)?$/
export const GRAPH_VERSION = 'v25.0'
export type GraphRequest = (path: string, token: string, body?: Record<string, string>) => Promise<unknown>
export async function instagramJson(path: string, token: string, body?: Record<string, string>): Promise<unknown> {
  if (!publishingPath.test(path)) throw new AppError('invalid_input', 'Consulta Instagram inválida.')
  return metaJson('instagram_login', path, token, body)
}
/** Facebook Login transport: the same publishing paths plus Page discovery and the audio catalog. */
export async function facebookJson(path: string, token: string, body?: Record<string, string>): Promise<unknown> {
  const discovery = /^me\/accounts\?fields=[a-z_,{}]+(&limit=\d{1,3})?$/
  const audio = /^ig_audio\?[\w=&%.~+-]+$/
  if (!publishingPath.test(path) && !discovery.test(path) && !(audio.test(path) && !body)) throw new AppError('invalid_input', 'Consulta Facebook inválida.')
  return metaJson('facebook_login', path, token, body)
}
function metaJson(login: AuthKind, path: string, token: string, body?: Record<string, string>): Promise<unknown> {
  // Test runs set this so no request ever leaves the machine, including automatic quota reads.
  if (process.env.LEGACY_PROVIDER_NETWORK === 'off') return Promise.reject(new AppError('internal', 'Rede de provedores desativada neste ambiente.'))
  rememberDiagnosticSecret(token)
  const host = login === 'facebook_login' ? 'graph.facebook.com' : 'graph.instagram.com'
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : undefined
    const req = request(`https://${host}/${GRAPH_VERSION}/${path}`, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let text = ''; res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk; if (text.length > 1024 * 1024) res.destroy() })
      res.on('error', () => reject(new AppError('internal', 'Resposta Instagram interrompida.')))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(text)
          if (parsed.error) diagnosticResponse(req, { error: { code: parsed.error.code, subcode: parsed.error.error_subcode, type: parsed.error.type, traceId: parsed.error.fbtrace_id } })
          if ((res.statusCode ?? 500) >= 400 || parsed.error) return reject(new InstagramApiError(res.statusCode ?? 500, Number(parsed.error?.code) || 0, retryAfterMs(res.headers['retry-after']), Number(parsed.error?.error_subcode) || undefined, login))
          resolve(parsed)
        } catch { reject(new AppError('internal', 'Resposta Instagram inválida.')) }
      })
    })
    req.on('error', () => reject(new AppError('internal', 'Não foi possível confirmar a resposta do Instagram.'))); req.end(data)
  })
}
export function instagramAccounts(ctx: Ctx, ws: string) {
  requireWorkspace(ctx,ws)
  return ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.state,'connected'))).all().map(r => ({id:r.providerId,username:r.username,revision:r.revision,validatedAt:r.validatedAt,authKind:r.authKind as AuthKind,expiresAt:r.expiresAt}))
}
export function accountAuthKind(ctx: Ctx, ws: string, accountId: string): AuthKind {
  const row = ctx.db.select({ authKind: destinationAccounts.authKind }).from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,accountId))).get()
  return (row?.authKind as AuthKind | undefined) ?? 'instagram_login'
}
/** Publishing host follows how the account was connected; Instagram Login accounts keep graph.instagram.com. */
export function accountTransport(ctx: Ctx, ws: string, accountId: string): GraphRequest {
  return accountAuthKind(ctx, ws, accountId) === 'facebook_login' ? facebookJson : instagramJson
}
export function instagramAccount(ctx: Ctx, ws: string, accountId?: string) {
  requireWorkspace(ctx, ws)
  if(accountId) {
    const record=ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,accountId))).get()
    if(record) return record.state==='connected' && getSecret(ctx,ws,`instagramToken:${accountId}`) ? {id:record.providerId,username:record.username,revision:record.revision,validatedAt:record.validatedAt,authKind:record.authKind as AuthKind,expiresAt:record.expiresAt} : null
  }
  const saved = getSetting(ctx.db, ws, 'instagramAccount')
  let value: ReturnType<typeof accountSchema.safeParse> | null=null
  try{value=saved?accountSchema.safeParse(JSON.parse(saved)):null}catch{ /* a corrupt default must never break explicit registered destinations */ }
  const accounts=instagramAccounts(ctx,ws)
  const selected=accountId ?? (value?.success ? value.data.id : accounts[0]?.id)
  if(selected) {
    const record=accounts.find(a=>a.id===selected)
    if(record) return getSecret(ctx,ws,`instagramToken:${selected}`) ? record : null
  }
  return value?.success && (!accountId || value.data.id===accountId) && getSecret(ctx, ws, 'instagramToken') ? { ...value.data, authKind: 'instagram_login' as AuthKind, expiresAt: null } : null
}
/** The active account: default destination of new publications. Only connected accounts of the workspace. */
export function setDefaultInstagramAccount(ctx: Ctx, ws: string, accountId: string) {
  requireWorkspace(ctx, ws)
  const account = instagramAccounts(ctx, ws).find(a => a.id === accountId)
  if (!account || !accountToken(ctx, ws, accountId)) throw new AppError('not_found', 'Conta não conectada neste workspace.')
  setSetting(ctx.db, ws, 'instagramAccount', JSON.stringify(account))
  return account
}
/** Reads the account's publishing limit from Meta and stores the snapshot. Never publishes. */
export async function refreshInstagramQuota(ctx: Ctx, ws: string, accountId: string, requestApi?: (path: string, token: string) => Promise<unknown>) {
  requireWorkspace(ctx, ws)
  requestApi ??= accountTransport(ctx, ws, accountId)
  const account = instagramAccount(ctx, ws, accountId)
  return fetchQuota(ctx, ws, accountId, account?.id === accountId ? accountToken(ctx, ws, accountId) : null, requestApi)
}
function accountToken(ctx: Ctx, ws: string, id: string) {
  const registered=ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,id))).get()
  if(registered) return getSecret(ctx,ws,`instagramToken:${id}`)
  const legacy=instagramAccount(ctx,ws,id)
  return legacy?.id===id ? getSecret(ctx,ws,'instagramToken') : null
}
export async function connectInstagram(ctx: Ctx, vault: SecretVault, ws: string, token: string, requestApi = instagramJson) {
  requireWorkspace(ctx, ws)
  const raw = await requestApi('me?fields=user_id,username', token) as { data?: unknown[] }
  const identity = z.object({ user_id: numericId, username: z.string().min(1).max(80) }).safeParse(raw.data?.[0] ?? raw)
  if (!identity.success) throw new AppError('invalid_input', 'O token não retornou uma conta profissional Instagram. Use Instagram User Access Token com Instagram Login; chave secreta, Client Token e token Facebook não servem para esta conexão.')
  const data = { id: identity.data.user_id, username: identity.data.username }
  // Querying account identity does not prove publish permission; the API enforces it at execution.
  const storedAccount=ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,data.id))).get()
  const previous = storedAccount ? {id:storedAccount.providerId,revision:storedAccount.revision} : instagramAccount(ctx, ws, data.id)
  const account = { ...data, revision: previous?.id === data.id ? previous.revision : randomUUID(), validatedAt: ctx.clock().toISOString(), authKind: 'instagram_login' as AuthKind, expiresAt: null }
  ctx.db.transaction(() => {
    // Import legacy destination before updating the default selection, keeping its jobs and credentials valid.
    const legacy=instagramAccount(ctx,ws)
    if(legacy && accountToken(ctx,ws,legacy.id)) {
      saveSecret(ctx,vault,ws,`instagramToken:${legacy.id}`,accountToken(ctx,ws,legacy.id)!)
      ctx.db.insert(destinationAccounts).values({workspaceId:ws,provider:'instagram',providerId:legacy.id,username:legacy.username,revision:legacy.revision,validatedAt:legacy.validatedAt}).onConflictDoNothing().run()
    }
    saveSecret(ctx, vault, ws, `instagramToken:${data.id}`, token)
    // Compatibility default for existing UI callers, never used to select credentials during execution.
    saveSecret(ctx, vault, ws, 'instagramToken', token)
    setSetting(ctx.db, ws, 'instagramAccount', JSON.stringify(account))
    ctx.db.insert(destinationAccounts).values({workspaceId:ws,provider:'instagram',providerId:data.id,username:data.username,revision:account.revision,validatedAt:account.validatedAt}).onConflictDoUpdate({target:[destinationAccounts.workspaceId,destinationAccounts.provider,destinationAccounts.providerId],set:{username:data.username,revision:account.revision,validatedAt:account.validatedAt,state:'connected',authKind:'instagram_login',expiresAt:null,permissionsJson:'[]'}}).run()
  })
  return account
}
/** Stores an Instagram account discovered through its Facebook Page. Reconnecting the same id keeps its revision and scheduled jobs. */
export function connectFacebookAccount(ctx: Ctx, vault: SecretVault, ws: string, input: { token: string; id: string; username: string; expiresAt: string | null; scopes: string[] }) {
  requireWorkspace(ctx, ws)
  const id = numericId.parse(input.id)
  const stored = ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,id))).get()
  const account = { id, username: input.username, revision: stored?.revision ?? randomUUID(), validatedAt: ctx.clock().toISOString(), authKind: 'facebook_login' as AuthKind, expiresAt: input.expiresAt }
  ctx.db.transaction(() => {
    saveSecret(ctx, vault, ws, `instagramToken:${id}`, input.token)
    const values = { username: account.username, revision: account.revision, validatedAt: account.validatedAt, state: 'connected', authKind: 'facebook_login' as const, expiresAt: input.expiresAt, permissionsJson: JSON.stringify(input.scopes) }
    ctx.db.insert(destinationAccounts).values({ workspaceId: ws, provider: 'instagram', providerId: id, ...values })
      .onConflictDoUpdate({ target: [destinationAccounts.workspaceId,destinationAccounts.provider,destinationAccounts.providerId], set: values }).run()
    if (!instagramAccount(ctx, ws)) setSetting(ctx.db, ws, 'instagramAccount', JSON.stringify(account))
  })
  return account
}
export async function verifyInstagram(ctx: Ctx, vault: SecretVault, ws: string, requestApi = instagramJson, accountId?: string) {
  requireWorkspace(ctx, ws)
  const selected=instagramAccount(ctx,ws,accountId)
  const token = selected ? accountToken(ctx,ws,selected.id) : null
  if (!token) throw new AppError('invalid_input', 'Conecte uma conta primeiro.')
  if (selected!.authKind === 'facebook_login') {
    const raw = await (requestApi === instagramJson ? facebookJson : requestApi)(`${selected!.id}?fields=id,username`, token)
    const identity = z.object({ id: numericId, username: z.string().min(1).max(80) }).safeParse(raw)
    if (!identity.success || identity.data.id !== selected!.id) throw new AppError('invalid_input', 'A conta não respondeu pelo Facebook Login. Entre com Facebook novamente em Contas.')
    const row = ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,selected!.id))).get()!
    return connectFacebookAccount(ctx, vault, ws, { token, id: selected!.id, username: identity.data.username, expiresAt: row.expiresAt, scopes: JSON.parse(row.permissionsJson) })
  }
  return connectInstagram(ctx, vault, ws, token, requestApi)
}
export function disconnectInstagram(ctx: Ctx, vault: SecretVault, ws: string, accountId?: string) {
  requireWorkspace(ctx,ws)
  const selected=instagramAccount(ctx,ws,accountId)
  if(!selected) return
  ctx.db.transaction(() => {
    saveSecret(ctx,vault,ws,`instagramToken:${selected.id}`,'')
    ctx.db.update(destinationAccounts).set({state:'disconnected'}).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,selected.id))).run()
    if(instagramAccount(ctx,ws)?.id===selected.id || !accountId) {saveSecret(ctx,vault,ws,'instagramToken','');setSetting(ctx.db,ws,'instagramAccount','')}
  })
}
type PublishItem = { postId: string | null; localAssetId: string; caption: string }
type ScheduleInput = { batchId?: string; accountId?: string; firstAt: string; intervalMin: number; cleanupAfterPublish?: boolean; shareToFeed?: boolean; allowRepost?: boolean; versionIds?: Record<string,string>; freshOnly?: boolean; trialGraduation?: 'MANUAL' | 'SS_PERFORMANCE'; audio?: Record<string, CatalogAudioChoice> }
/** Job payload fields for catalog music; absent when the video keeps its own audio, so older payloads compare equal. */
export function audioPayload(choice?: CatalogAudioChoice | null) {
  return choice?.audioId ? { audioId: choice.audioId, audioVolume: choice.audioVolume, videoVolume: choice.videoVolume } : {}
}
const payloadAudio = (p: { audioId?: string; audioVolume?: number; videoVolume?: number }): CatalogAudioChoice | null =>
  p.audioId ? { audioId: p.audioId, audioVolume: p.audioVolume ?? DEFAULT_AUDIO_VOLUME, videoVolume: p.videoVolume ?? DEFAULT_VIDEO_VOLUME } : null
function enqueuePublications(ctx: Ctx, ws: string, account: NonNullable<ReturnType<typeof instagramAccount>>, posts: PublishItem[], input: ScheduleInput): JobView[] {
  const first = new Date(input.firstAt)
  const last = first.getTime() + (posts.length - 1) * input.intervalMin * 60000
  if (!posts.length || !Number.isFinite(first.getTime()) || !Number.isInteger(input.intervalMin) || input.intervalMin < 15 || first.getTime() < ctx.clock().getTime() + 60_000 || last > ctx.clock().getTime() + 90 * 86400_000) throw new AppError('invalid_input', 'Escolha entre um minuto e 90 dias no futuro para todo o lote.')
  for (const post of posts) if (post.caption.length > 2200) throw new AppError('invalid_input', 'Edite a legenda: o limite é de 2200 caracteres.')
  const key = (post: PublishItem, i: number) => `publish:${ws}:${account.id}:${post.postId ?? post.localAssetId}:${new Date(first.getTime() + i * input.intervalMin * 60000).toISOString()}`
  const batchId = input.batchId ?? randomUUID()
  return ctx.db.transaction(() => {
    if (input.freshOnly) for (const [i,post] of posts.entries()) {
      const publishAt=new Date(first.getTime()+i*input.intervalMin*60000).toISOString()
      const collision=ctx.db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.type,'publish_instagram'),
        sql`json_extract(${jobs.payloadJson},'$.accountId')=${account.id} and json_extract(${jobs.payloadJson},'$.localAssetId')=${post.localAssetId}
          and coalesce(json_extract(${jobs.payloadJson},'$.publishAt'),${jobs.runAt})=${publishAt}`)).get()
      if(collision)throw new AppError('duplicate','Esta intenção já pertence a outro Container ou lote legado.')
    }
    const repeated = posts.map((post, i) => ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.idempotencyKey, key(post, i)))).get())
    if (input.freshOnly && repeated.some(Boolean)) throw new AppError('duplicate','Esta intenção já pertence a outro Container ou lote legado.')
    for(const [i,row] of repeated.entries()) if(row) {
      const p=JSON.parse(row.payloadJson)
      if(p.caption!==posts[i].caption || (p.shareToFeed??true)!==(input.shareToFeed??true) || p.versionId!==input.versionIds?.[posts[i].localAssetId] || !sameAudio(payloadAudio(p), input.audio?.[posts[i].localAssetId])) throw new AppError('duplicate','Já existe uma intenção para esta mídia, conta e horário com outra configuração. Edite ou reagende a tarefa existente.')
    }
    if (repeated.every(Boolean)) return repeated.map(r => ({id:r!.id,workspaceId:r!.workspaceId,type:'publish_instagram',state:r!.state,attempts:r!.attempts,maxAttempts:r!.maxAttempts,runAt:r!.runAt,lastError:r!.lastError,label:r!.label,createdAt:r!.createdAt,updatedAt:r!.updatedAt}))
    if (!input.allowRepost && repostWarnings(ctx, ws, account.id, { postIds: posts.flatMap(p => p.postId ? [p.postId] : []), assetIds: posts.filter(p => !p.postId).map(p => p.localAssetId) }).length) throw new AppError('duplicate', 'Possível repostagem nesta conta. Revise o aviso e confirme antes de agendar novamente.')
    return posts.map((post, i) => enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', label: `Publicar reel em @${account.username}`, payload: { ...post, media:post.localAssetId, provider:'instagram', destinationAccount:account.id, publishAt:new Date(first.getTime() + i * input.intervalMin * 60000).toISOString(), username: account.username, accountId: account.id, accountRevision: account.revision, cleanupAfterPublish: input.cleanupAfterPublish ?? false, shareToFeed: input.shareToFeed ?? true, versionId: input.versionIds?.[post.localAssetId], allowRepost: input.allowRepost ?? false, batchId, ...audioPayload(input.audio?.[post.localAssetId]), ...(input.trialGraduation ? { trialGraduation: input.trialGraduation } : {}) }, runAt: new Date(first.getTime() + i * input.intervalMin * 60000), maxAttempts: pipelineConfig.maxRetries, idempotencyKey: key(post, i) }, ctx.clock()))
  })
}
export function scheduleInstagram(ctx: Ctx, ws: string, input: ScheduleInput & { postIds: string[]; caption?: string; captions?: Record<string,string> }) {
  if (!Number.isInteger(input.intervalMin) || input.intervalMin<15 || input.intervalMin>10080 || !Number.isFinite(Date.parse(input.firstAt))) throw new AppError('invalid_input','Horário ou intervalo inválido.')
  const account = instagramAccount(ctx, ws, input.accountId)
  if (!account) throw new AppError('invalid_input', 'Conecte uma conta profissional Instagram em Contas antes de programar.')
  const posts = [...new Set(input.postIds)].map(id => {
    const post = getRemotePost(ctx.db, ws, id)
    if (!post) throw new AppError('not_found', 'Post não encontrado neste workspace.')
    if (!post.assetId) throw new AppError('invalid_input', 'Baixe o vídeo antes de agendar. O Instagram publica a cópia local.')
    return { postId: id, localAssetId: post.assetId, caption: input.captions?.[id] ?? input.caption ?? post.caption ?? '' }
  })
  return scheduleContainerIntents(ctx, ws, posts.map((post,i) => ({ media:post.localAssetId, provider:'instagram', destinationAccount:account.id,
    accountRevision:account.revision, publishAt:new Date(Date.parse(input.firstAt)+i*input.intervalMin*60000).toISOString(), caption:post.caption,
    versionId:input.versionIds?.[post.localAssetId], sourcePostId:post.postId ?? undefined, shareToFeed:input.shareToFeed ?? true, allowRepost:input.allowRepost ?? false })), input.batchId, input.intervalMin)
}
type CompositionInput = { batchId?: string; assetIds: string[]; accountId: string; accountRevision: string; firstAt: string; intervalMin: number; captions: Record<string,string>; cleanupAfterPublish: boolean; shareToFeed?: boolean; versionIds?: Record<string,string>; allowRepost?: boolean; freshOnly?: boolean; sourcePostIds?: Record<string,string>; trialGraduation?: 'MANUAL' | 'SS_PERFORMANCE'; audio?: Record<string, CatalogAudioChoice> }
export function scheduleComposition(ctx: Ctx, ws: string, input: CompositionInput) {
  if (!Number.isInteger(input.intervalMin) || input.intervalMin<15 || input.intervalMin>10080 || !Number.isFinite(Date.parse(input.firstAt))) throw new AppError('invalid_input','Horário ou intervalo inválido.')
  return scheduleContainerIntents(ctx, ws, [...new Set(input.assetIds)].map((media,i) => ({ media, provider:'instagram', destinationAccount:input.accountId,
    accountRevision:input.accountRevision, publishAt:new Date(Date.parse(input.firstAt)+i*input.intervalMin*60000).toISOString(),
    caption:input.captions[media] ?? '', versionId:input.versionIds?.[media], shareToFeed:input.shareToFeed ?? true, allowRepost:input.allowRepost ?? false, audio:input.audio?.[media] })), input.batchId, input.intervalMin)
}
/** Internal job creation: called only inside the Container scheduling transaction. */
export function scheduleCompositionRaw(ctx: Ctx, ws: string, input: CompositionInput) {
 for (const [assetId, versionId] of Object.entries(input.versionIds ?? {})) { if (!listVersions(ctx.db, ws, assetId).some(v => v.id === versionId && v.kind === 'banner') && !ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'apply_banner'), inArray(jobs.state, ['queued', 'running']))).all().some(j => {const p = JSON.parse(j.payloadJson);return p.versionId === versionId && p.assetId === assetId})) throw new AppError('invalid_input', 'Versão editada inválida neste workspace.') }
 const account=instagramAccount(ctx,ws,input.accountId)
 if (!account || account.id!==input.accountId || account.revision!==input.accountRevision) throw new AppError('invalid_input','O destino mudou. Atualize e revise a conta antes de confirmar.')
 const mapped=[...new Set(input.assetIds)].map(assetId=>{
  if(!getAsset(ctx.db,ws,assetId)) throw new AppError('not_found','Vídeo não encontrado neste workspace.')
  const post=ctx.db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId,ws),eq(remotePosts.assetId,assetId))).orderBy(desc(remotePosts.metricsUpdatedAt)).get()
  return {postId:input.sourcePostIds?.[assetId] ?? post?.id ?? null,localAssetId:assetId,caption:input.captions[assetId] ?? ''}
 })
 return enqueuePublications(ctx,ws,account,mapped,input)
}
export function schedulePublicationBatch(ctx: Ctx, ws: string, batchId: string, items: {media:string;provider:'instagram';destinationAccount:string;accountRevision:string;publishAt:string;caption:string;versionId?:string;shareToFeed:boolean;allowRepost:boolean}[]) {
  return scheduleContainerIntents(ctx,ws,items,batchId)
}
/** Container field for catalog music, sent with the Reel creation (before media_publish). Empty without music. */
export function reelAudioConfiguration(audio: CatalogAudioChoice | null): { audio_configuration?: string } {
  return audio ? { audio_configuration: JSON.stringify({ audio_id: audio.audioId, audio_volume: audio.audioVolume, video_volume: audio.videoVolume }) } : {}
}
export class InstagramPending extends AppError { constructor(public retryAfterMs = pipelineConfig.pollMs) { super('internal', 'O Instagram ainda está preparando o vídeo. Nova consulta em instantes.') } }
export type PublishDeps = { host: MediaHost; prepare: (input: string, tmpDir: string) => Promise<PreparedCopy> }
export const defaultPublishDeps = (): PublishDeps => ({ host: defaultMediaHost(), prepare: preparePublishCopy })
const PUBLISH_FAILED = 'O Instagram não conseguiu processar o vídeo enviado pelo link temporário.'
const quietly = (p: Promise<void>) => p.catch(() => {})

export async function publishInstagram(ctx: Ctx, job: LeasedJob, requestApi?: GraphRequest, deps: PublishDeps = defaultPublishDeps()) {
  const payload = z.object({ postId: z.string().nullish(), localAssetId: z.string().nullish(), versionId: z.string().optional(), allowRepost: z.boolean().default(false), caption: z.string().max(2200), accountId: numericId, accountRevision: z.string(), cleanupAfterPublish: z.boolean().default(false), shareToFeed: z.boolean().default(true), trialGraduation: z.enum(['MANUAL', 'SS_PERFORMANCE']).optional(),
    audioId: catalogAudioChoice.shape.audioId.optional(), audioVolume: catalogAudioChoice.shape.audioVolume.optional(), videoVolume: catalogAudioChoice.shape.videoVolume.optional() }).parse(job.payload)
  const audio = payloadAudio(payload)
  if (audio && accountAuthKind(ctx, job.workspaceId, payload.accountId) !== 'facebook_login') throw new AppError('invalid_input', 'Música do catálogo exige a conta conectada por Facebook Login. Entre com Facebook em Contas ou remova a música e reagende.')
  requestApi ??= accountTransport(ctx, job.workspaceId, payload.accountId)
  // Cleanup of stale exposures (any job) must never fail this publication.
  await quietly(releaseExpired())
  const recorded = ctx.db.select().from(publicationHistory).where(and(eq(publicationHistory.workspaceId,job.workspaceId),eq(publicationHistory.jobId,job.id))).get()
  if (recorded) return { mediaId: recorded.mediaId, confirmedPublished: true, cleanupState: recorded.cleanupState }
  // A Container job must still carry the caption and recipe frozen in its item when it was scheduled.
  const item = ctx.db.select({ effective: publicationContainerItems.effectiveSnapshotJson }).from(publicationContainerItems)
    .where(and(eq(publicationContainerItems.workspaceId, job.workspaceId), eq(publicationContainerItems.jobId, job.id))).get()
  if (item?.effective) {
    const frozen = JSON.parse(item.effective) as { caption?: string; recipeVersionId?: string | null; trialGraduation?: string | null; audio?: CatalogAudioChoice | null }
    if (frozen.caption !== payload.caption || (frozen.recipeVersionId ?? undefined) !== payload.versionId || (frozen.trialGraduation ?? undefined) !== payload.trialGraduation || !sameAudio(frozen.audio, audio)) throw new AppError('invalid_input', 'A publicação não corresponde à intenção congelada no Container. Revise o Container antes de reagendar.')
  }
  const account = instagramAccount(ctx, job.workspaceId, payload.accountId)
  if (!account || account.id !== payload.accountId || account.revision !== payload.accountRevision) throw new AppError('invalid_input', 'A conta conectada mudou. Recrie o agendamento após revisar o destino.')
  const ws = job.workspaceId
  const assetId = payload.localAssetId ?? (payload.postId ? getRemotePost(ctx.db, ws, payload.postId)?.assetId : null)
  const asset = assetId ? getAsset(ctx.db, ws, assetId) : null
  const token = accountToken(ctx, ws, account.id)!
  const where = and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))
  const checkpoint = JSON.parse(ctx.db.select().from(jobs).where(where).get()?.resultJson ?? '{}') as { publicationLimit?: { resumeAt: string }; processedCachePath?: string; firstPollAt?:string; stage?: string; stageAt?: string; mediaProcessingId?: string; uploadId?: string; creating?: boolean; containerId?: string; publishing?: boolean; mediaId?: string; hostId?: string; exposedAt?: string; failedContainers?: { id: string; status: string; at: string }[] }
  const assertOwned = () => {if(!ctx.db.select({id:jobs.id}).from(jobs).where(ownedJob(ctx.db,job,ctx.clock())).get()) throw new AppError('forbidden','Lease da publicação expirada. O worker interrompeu a operação.')}
  const save = () => {
    const accepted=ctx.db.update(jobs).set({ resultJson: JSON.stringify(checkpoint) }).where(ownedJob(ctx.db,job,ctx.clock())).run().changes>0
    traceLease(ctx.db,job.id,job.leaseVersion,'save checkpoint',accepted)
    if(!accepted) throw new AppError('forbidden','Lease da publicação expirada. Checkpoint preservado.')
  }
  const stage = (value: string) => {
    const duration=checkpoint.stageAt?ctx.clock().getTime()-Date.parse(checkpoint.stageAt):undefined
    recordDiagnostic({source:'publication',level:'INFO',message:value,metadata:{previousStage:checkpoint.stage},duration})
    checkpoint.stage=value;checkpoint.stageAt=ctx.clock().toISOString();save()
  }
  const rawApi=requestApi
  requestApi=async (path,tok,body) => {
    assertOwned()
    if (body) assertNewPublicationAllowed(ctx.db, ws, job.id)
    if(instagramAccount(ctx,ws,payload.accountId)?.revision!==payload.accountRevision) throw new AppError('invalid_input','Conta desconectada durante a execução. Reconecte o mesmo destino para retomar.')
    const operation=path.includes('media_publish')?'publish':body?'create':'status'
    try {const result=await rawApi(path,tok,body);assertOwned();providerSucceeded(ctx,ws,account.id,operation);return result}
    catch(error){
      if(error instanceof InstagramApiError && error.retryable && !error.publicationLimited)providerCooldown(ctx,ws,account.id,operation,error)
      // Meta is authoritative: read the limit it reports now, so the deferral uses its window. Best effort.
      if(error instanceof InstagramApiError && error.publicationLimited)await fetchQuota(ctx,ws,account.id,token,rawApi).catch(()=>null)
      throw error
    }
  }
  const confirmed = async () => {
    assertOwned()
    stage('CONFIRMED')
    await quietly(releaseExposure(job.id))
    const row = await recordPublication(ctx, { workspaceId: ws, jobId: job.id, accountId: account.id, username: account.username, postId: payload.postId ?? null, assetId: asset?.id ?? null, mediaId: checkpoint.mediaId, cleanup: false, cleanupAssetId: asset?.id ?? null })
    return { ...checkpoint, confirmedPublished: true, cleanupState: row.cleanupState }
  }
  // Retry after ERROR must create a fresh container; the failed one stays ERROR forever.
  const failContainer = async (code?: string, terminal = 'ERROR'): Promise<never> => {
    const legacy = !checkpoint.hostId
    if (checkpoint.containerId) checkpoint.failedContainers = [...(checkpoint.failedContainers ?? []), { id: checkpoint.containerId, status: terminal, at: ctx.clock().toISOString() }].slice(-24)
    await quietly(releaseExposure(job.id))
    delete checkpoint.containerId; delete checkpoint.exposedAt; delete checkpoint.firstPollAt; checkpoint.creating = false; save()
    if (checkpoint.publicationLimit && terminal === 'EXPIRED') throw new InstagramPending(1)
    if (legacy && (terminal === 'ERROR' || terminal === 'EXPIRED')) throw new InstagramPending(15_000)
    throw new AppError('invalid_input', `${PUBLISH_FAILED}${code ? ` (código Meta ${code})` : ''}`)
  }
  if (checkpoint.mediaId) return confirmed()
  if (!checkpoint.containerId) {
    if (!payload.allowRepost && repostWarnings(ctx, ws, account.id, { assetIds: assetId ? [assetId] : [], postIds: !assetId && payload.postId ? [payload.postId] : [] }).some(r => r.reason.includes('já foi publicado'))) throw new AppError('duplicate', 'Este vídeo foi publicado nesta conta depois do agendamento. Reagende pela Biblioteca e confirme a repostagem intencional.')
    if (checkpoint.creating) throw new AppError('invalid_input', 'Criação do vídeo sem confirmação. Confira o Instagram antes de recriar a tarefa.')
    assertNewPublicationAllowed(ctx.db, ws, job.id)
    assertPublicationQuota(ctx, ws, account.id)
    if (!asset || !existsSync(asset.filePath)) throw new AppError('invalid_input', 'Baixe ou importe o vídeo antes de publicar. O Instagram publica a cópia local.')
    const tmpDir = publishTmpDir(ctx, ws)
    const version = payload.versionId ? listVersions(ctx.db, ws, asset.id).find(v => v.id === payload.versionId && v.kind === 'banner') : null
    if(payload.versionId && !version) {
      const editing=ctx.db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.type,'apply_banner'),inArray(jobs.state,['queued','running']),sql`json_extract(${jobs.payloadJson}, '$.versionId') = ${payload.versionId}`)).get()
      if(editing) throw new InstagramPending()
      throw new AppError('invalid_input', 'Versão editada não encontrada neste workspace.')
    }
    checkpoint.mediaProcessingId=`${job.id}:media:${payload.versionId??asset.sha256}`;stage('PREPARING_MEDIA')
    let videoUrl: string
    try {
      videoUrl = await exposeForJob(job.id, async () => {
        const input=version ? await materializeVersion(ctx,ws,asset.id,version.id) : asset.filePath
        if(version) { checkpoint.processedCachePath=input; save() }
        const prepared=await deps.prepare(input, tmpDir)
        try{stage('MEDIA_READY');checkpoint.uploadId=`${job.id}:upload`;stage('UPLOADING');return prepared}catch(e){prepared.cleanup();throw e}
      }, deps.host)
    }catch(error){if(error instanceof ExposureCapacityError) throw new InstagramPending();throw error}
    try { assertNewPublicationAllowed(ctx.db, ws, job.id) } catch (e) { await quietly(releaseExposure(job.id)); throw e }
    checkpoint.creating = true; checkpoint.hostId = deps.host.id; checkpoint.exposedAt = ctx.clock().toISOString(); save()
    let response: unknown
    try { response = await requestApi(`${account.id}/media`, token, { media_type: 'REELS', video_url: videoUrl, caption: payload.caption, share_to_feed: String(payload.shareToFeed), ...(payload.versionId ? { thumb_offset: '0' } : {}),
      // Trial reels: Meta shows them first to non-followers; eligibility is decided by Meta per account.
      ...(payload.trialGraduation ? { trial_params: JSON.stringify({ graduation_strategy: payload.trialGraduation }) } : {}),
      ...reelAudioConfiguration(audio) }) }
    catch (e) {
      if (e instanceof ContainerHeld || (e instanceof InstagramApiError && e.status < 500)) { checkpoint.creating = false; save(); await quietly(releaseExposure(job.id)) }
      // A refused trial reel is almost always eligibility: say so instead of a generic parameter error.
      if (payload.trialGraduation && e instanceof InstagramApiError && !e.retryable && [100, 10, 200].includes(e.apiCode)) throw new AppError('invalid_input', `A Meta recusou o envio como Reels de teste (código ${e.apiCode}). A conta pode não ser elegível: use um perfil profissional público ou desative Reels de teste no Container e reagende.`)
      throw e
    }
    checkpoint.containerId = z.object({ id: numericId }).parse(response).id; stage('PROVIDER_PROCESSING')
  }
  if(!checkpoint.firstPollAt){checkpoint.firstPollAt=ctx.clock().toISOString();save()}
  const status = z.object({ status_code: z.string(), status: z.string().optional() }).parse(await requestApi(`${numericId.parse(checkpoint.containerId)}?fields=status_code,status`, token))
  if (status.status_code === 'PUBLISHED') return confirmed()
  if (checkpoint.publishing) {
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw new AppError('invalid_input', `Publicação sem confirmação; a Meta informou ${status.status_code}. Confira a conta antes de tentar novamente. O contêiner foi preservado.`)
    if(ctx.clock().getTime()-Date.parse(checkpoint.exposedAt??checkpoint.firstPollAt)>pipelineConfig.confirmationTimeoutMs) throw new AppError('invalid_input','Publicação sem confirmação no prazo. Contêiner preservado para reconciliação.')
    throw new InstagramPending()
  }
  if (status.status_code === 'IN_PROGRESS') {
    const started = Date.parse(checkpoint.exposedAt??checkpoint.firstPollAt)
    if (ctx.clock().getTime() - started > SHARE_TTL_MS) return failContainer()
    throw new InstagramPending()
  }
  // `status` carries Meta's subcode (e.g. "Error: 2207026"); it identifies the cause in the error reference.
  if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') return failContainer(status.status?.match(/\d{4,}/)?.[0], status.status_code)
  if (status.status_code !== 'FINISHED') throw new AppError('invalid_input', 'Estado de preparação desconhecido. A tarefa preservou o contêiner para revisão.')
  await quietly(releaseExposure(job.id))
  assertNewPublicationAllowed(ctx.db, ws, job.id)
  checkpoint.publishing = true; stage('PUBLISHING')
  let response: unknown
  try { response = await requestApi(`${account.id}/media_publish`, token, { creation_id: checkpoint.containerId }) }
  catch (e) { if (e instanceof ContainerHeld || (e instanceof InstagramApiError && e.status < 500)) { checkpoint.publishing = false; save() } throw e }
  checkpoint.mediaId = z.object({ id: numericId }).parse(response).id;stage('WAITING_CONFIRMATION');return confirmed()
}

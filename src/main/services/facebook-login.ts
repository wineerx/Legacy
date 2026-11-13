import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { requireWorkspace, type SecretVault } from './integrations'
import { connectFacebookAccount, facebookJson, type GraphRequest } from './instagram-publishing'
import { rememberDiagnosticSecret } from '../diagnostics'

/**
 * Facebook Login through the Legacy broker. The broker holds the app secret and exchanges the code;
 * this side opens the browser, receives a one-time proof on 127.0.0.1 and redeems the token once.
 */
export const REQUIRED_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement']
const LOGIN_TIMEOUT_MS = 10 * 60_000
const PENDING_TTL_MS = 10 * 60_000

export interface BrokerFetch { (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> }
export interface LoginDeps {
  brokerUrl: string
  openExternal(url: string): Promise<void>
  fetch?: BrokerFetch
  request?: GraphRequest
  /** Resolves with the proof once the browser reaches the loopback listener. */
  listen?: (sessionId: () => string) => Promise<{ port: number; proof: Promise<string>; close(): void }>
}
export interface FacebookCandidate { id: string; username: string; pageName: string }
type Pending = { token: string; expiresAt: string | null; scopes: string[]; candidates: FacebookCandidate[]; until: number }
const pending = new Map<string, Pending>()

export function brokerUrl(): string {
  const value = process.env.LEGACY_BROKER_URL?.trim()
  if (!value) throw new AppError('invalid_input', 'Login com Facebook indisponível nesta instalação: o endereço do broker não foi configurado.')
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new AppError('invalid_input', 'O broker precisa usar HTTPS.')
  return url.origin
}

const page = (title: string) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Legacy</title><body style="font-family:system-ui;padding:40px;background:#111;color:#eee"><h1 style="font-size:20px">${title}</h1><p>Você já pode fechar esta aba e voltar ao Legacy.</p></body></html>`
export function loopbackListener(sessionId: () => string): Promise<{ port: number; proof: Promise<string>; close(): void }> {
  let settle!: { resolve(v: string): void; reject(e: Error): void }
  const proof = new Promise<string>((resolve, reject) => { settle = { resolve, reject } })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/facebook/callback' || !sessionId() || url.searchParams.get('session') !== sessionId()) { res.writeHead(404).end(); return }
    const error = url.searchParams.get('error'), value = url.searchParams.get('proof') ?? ''
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(page(error === 'denied' ? 'Login cancelado' : error ? 'Não foi possível concluir o login' : 'Login concluído'))
    // A denied or failed login still carries a proof: the broker reports the reason on redemption.
    if (/^[\w-]{20,128}$/.test(value)) settle.resolve(value)
    else settle.reject(new AppError('invalid_input', 'Retorno do login inválido. Tente de novo.'))
  })
  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new AppError('internal', 'Não foi possível abrir a porta local do login.')))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new AppError('internal', 'Não foi possível abrir a porta local do login.'))
      resolve({ port: address.port, proof, close: () => server.close() })
    })
  })
}

async function brokerJson(fetcher: BrokerFetch, url: string, body: unknown, bearer?: string) {
  let res: Awaited<ReturnType<BrokerFetch>>
  try { res = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }) }
  catch { throw new AppError('internal', 'Não foi possível falar com o broker do Legacy. Confira a internet e tente de novo.') }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    if (data.error === 'denied') throw new AppError('invalid_input', 'O login com Facebook foi cancelado.')
    if (data.error === 'exchange_failed') throw new AppError('invalid_input', 'A Meta não confirmou o login. Confira se o app está em modo Live e se sua conta tem acesso a ele.')
    if (data.error === 'expired') throw new AppError('invalid_input', 'O login expirou. Tente de novo.')
    throw new AppError('internal', `O broker recusou o login (HTTP ${res.status}).`)
  }
  return data
}

/** Pages the person manages that have a professional Instagram account linked. */
export async function discoverFacebookAccounts(token: string, request: GraphRequest = facebookJson): Promise<FacebookCandidate[]> {
  const raw = await request('me/accounts?fields=name,instagram_business_account{id,username}&limit=100', token)
  const pages = z.object({ data: z.array(z.object({ name: z.string().default(''), instagram_business_account: z.object({ id: z.string().regex(/^\d+$/), username: z.string().min(1).max(80) }).optional() }).loose()).default([]) }).loose().safeParse(raw)
  if (!pages.success) throw new AppError('internal', 'Resposta inesperada da Meta ao listar Páginas.')
  const seen = new Set<string>()
  return pages.data.data.flatMap(p => p.instagram_business_account && !seen.has(p.instagram_business_account.id) && seen.add(p.instagram_business_account.id)
    ? [{ id: p.instagram_business_account.id, username: p.instagram_business_account.username, pageName: p.name }] : [])
}

export async function beginFacebookLogin(deps: LoginDeps) {
  const fetcher = deps.fetch ?? (fetch as unknown as BrokerFetch)
  const listen = deps.listen ?? loopbackListener
  // The session id is only known after the broker answers, so the listener reads it lazily.
  let sessionId = ''
  const listener = await listen(() => sessionId)
  try {
    const started = z.object({ sessionId: z.string(), pollToken: z.string(), authorizeUrl: z.string() }).parse(await brokerJson(fetcher, `${deps.brokerUrl}/v1/facebook/sessions`, { loopbackPort: listener.port }))
    sessionId = started.sessionId
    const authorize = new URL(started.authorizeUrl)
    if (authorize.protocol !== 'https:' || authorize.hostname !== 'www.facebook.com') throw new AppError('internal', 'Endereço de autorização inesperado.')
    await deps.openExternal(authorize.toString())
    const proof = await Promise.race([listener.proof, new Promise<never>((_, reject) => setTimeout(() => reject(new AppError('invalid_input', 'O login não foi concluído em 10 minutos. Tente de novo.')), LOGIN_TIMEOUT_MS).unref?.())])
    const redeemed = z.object({ accessToken: z.string().min(20), expiresAt: z.string().nullable(), scopes: z.array(z.string()) })
      .parse(await brokerJson(fetcher, `${deps.brokerUrl}/v1/facebook/sessions/${encodeURIComponent(sessionId)}/token`, { proof }, started.pollToken))
    rememberDiagnosticSecret(redeemed.accessToken)
    const missing = redeemed.scopes.length ? REQUIRED_SCOPES.filter(s => !redeemed.scopes.includes(s)) : []
    if (missing.length) throw new AppError('forbidden', `Permissões não concedidas: ${missing.join(', ')}. Entre com Facebook de novo e marque todas.`)
    const candidates = await discoverFacebookAccounts(redeemed.accessToken, deps.request)
    if (!candidates.length) throw new AppError('invalid_input', 'Nenhuma Página com conta Instagram profissional vinculada foi autorizada. Vincule a conta a uma Página e selecione essa Página no login.')
    const handle = randomUUID()
    for (const [key, value] of pending) if (value.until < Date.now()) pending.delete(key)
    pending.set(handle, { token: redeemed.accessToken, expiresAt: redeemed.expiresAt, scopes: redeemed.scopes, candidates, until: Date.now() + PENDING_TTL_MS })
    return { handle, accounts: candidates }
  } finally { listener.close() }
}

/** Saves the chosen account in the vault. The pending token is used once and then forgotten. */
export function finishFacebookLogin(ctx: Ctx, vault: SecretVault, ws: string, handle: string, accountId: string) {
  requireWorkspace(ctx, ws)
  const login = pending.get(handle)
  if (!login || login.until < Date.now()) { pending.delete(handle); throw new AppError('invalid_input', 'O login expirou. Entre com Facebook de novo.') }
  const chosen = login.candidates.find(c => c.id === accountId)
  if (!chosen) throw new AppError('not_found', 'Conta não autorizada neste login.')
  const account = connectFacebookAccount(ctx, vault, ws, { token: login.token, id: chosen.id, username: chosen.username, expiresAt: login.expiresAt, scopes: login.scopes })
  pending.delete(handle)
  return account
}

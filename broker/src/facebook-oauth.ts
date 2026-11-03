/**
 * Facebook Login broker. The app secret lives only here; the desktop app never sees it.
 *
 * Flow: the app opens a session (gets a poll token), the person authorizes in the browser, Meta calls back here,
 * the broker exchanges the code for a long-lived user token, seals it and redirects the browser to the app's
 * loopback listener with a one-time proof. The app then redeems poll token + proof for the token, once.
 * A link forwarded to someone else is useless to the session owner: the proof lands on the other person's machine.
 */

export interface KvStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
export interface BrokerEnv {
  FB_APP_ID: string
  FB_APP_SECRET: string
  /** Base64 of 32 random bytes; seals tokens while they wait to be redeemed. */
  SESSION_KEY: string
  PUBLIC_ORIGIN: string
  GRAPH_VERSION?: string
  SESSIONS: KvStore
}
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'] as const
export const SESSION_TTL_S = 600
export const READY_TTL_S = 300
const graphVersion = (env: BrokerEnv) => /^v\d+\.\d+$/.test(env.GRAPH_VERSION ?? '') ? env.GRAPH_VERSION! : 'v25.0'
const callbackUrl = (env: BrokerEnv) => `${env.PUBLIC_ORIGIN.replace(/\/$/, '')}/v1/facebook/callback`

type Session =
  | { status: 'pending'; port: number; pollHash: string; createdAt: string }
  | { status: 'ready'; port: number; pollHash: string; proofHash: string; sealed: string; expiresAt: string | null; scopes: string[] }
  | { status: 'failed'; port: number; pollHash: string; proofHash: string; reason: 'denied' | 'exchange_failed' }

const enc = new TextEncoder()
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))
async function sha256(value: string) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))) }
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
async function sealKey(env: BrokerEnv) {
  const raw = fromB64(env.SESSION_KEY)
  if (raw.length !== 32) throw new Error('SESSION_KEY must be 32 bytes in base64')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(env: BrokerEnv, value: string, sessionId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(sessionId) }, await sealKey(env), enc.encode(value)))
  return `${b64url(iv)}.${b64url(data)}`
}
async function unseal(env: BrokerEnv, sealed: string, sessionId: string) {
  const [iv, data] = sealed.split('.')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(sessionId) }, await sealKey(env), fromB64(data)))
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const fail = (status: number, error: string) => json({ error }, status)
const sessionKey = (id: string) => `fb:session:${id}`
const stateKey = (state: string) => `fb:state:${state}`

export async function startSession(env: BrokerEnv, body: unknown) {
  const port = Number((body as { loopbackPort?: unknown } | null)?.loopbackPort)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return fail(400, 'invalid_port')
  const sessionId = random(18), pollToken = random(), state = random()
  const session: Session = { status: 'pending', port, pollHash: await sha256(pollToken), createdAt: new Date().toISOString() }
  await env.SESSIONS.put(sessionKey(sessionId), JSON.stringify(session), { expirationTtl: SESSION_TTL_S })
  await env.SESSIONS.put(stateKey(state), sessionId, { expirationTtl: SESSION_TTL_S })
  const authorize = new URL(`https://www.facebook.com/${graphVersion(env)}/dialog/oauth`)
  authorize.search = new URLSearchParams({ client_id: env.FB_APP_ID, redirect_uri: callbackUrl(env), state, response_type: 'code', scope: SCOPES.join(',') }).toString()
  return json({ sessionId, pollToken, authorizeUrl: authorize.toString(), expiresInS: SESSION_TTL_S })
}

async function graph(fetcher: FetchLike, env: BrokerEnv, path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${graphVersion(env)}/${path}`)
  url.search = new URLSearchParams(params).toString()
  const res = await fetcher(url.toString())
  const body = await res.json() as Record<string, unknown>
  if (!res.ok || body.error) throw new Error(`graph_${res.status}`)
  return body
}
async function exchange(fetcher: FetchLike, env: BrokerEnv, code: string) {
  const short = await graph(fetcher, env, 'oauth/access_token', { client_id: env.FB_APP_ID, client_secret: env.FB_APP_SECRET, redirect_uri: callbackUrl(env), code })
  if (typeof short.access_token !== 'string') throw new Error('no_token')
  const long = await graph(fetcher, env, 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.FB_APP_ID, client_secret: env.FB_APP_SECRET, fb_exchange_token: short.access_token })
  if (typeof long.access_token !== 'string') throw new Error('no_token')
  const expiresIn = Number(long.expires_in)
  // The permissions read uses the token in a header so it never sits in a URL.
  const res = await fetcher(`https://graph.facebook.com/${graphVersion(env)}/me/permissions`, { headers: { Authorization: `Bearer ${long.access_token}` } })
  const perms = res.ok ? await res.json() as { data?: { permission?: string; status?: string }[] } : {}
  const scopes = (perms.data ?? []).filter(p => p.status === 'granted' && typeof p.permission === 'string').map(p => p.permission!)
  return { token: long.access_token, expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null, scopes }
}
function backToApp(port: number, params: Record<string, string>) {
  return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${port}/facebook/callback?${new URLSearchParams(params)}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}

export async function callback(env: BrokerEnv, url: URL, fetcher: FetchLike) {
  const state = url.searchParams.get('state') ?? ''
  const sessionId = state ? await env.SESSIONS.get(stateKey(state)) : null
  if (!sessionId) return new Response('Sessão de login expirada ou já usada. Volte ao Legacy e tente de novo.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  // A state is single use: a replayed callback finds nothing.
  await env.SESSIONS.delete(stateKey(state))
  const raw = await env.SESSIONS.get(sessionKey(sessionId))
  const session = raw ? JSON.parse(raw) as Session : null
  if (!session || session.status !== 'pending') return new Response('Sessão de login expirada. Volte ao Legacy e tente de novo.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const proof = random(), proofHash = await sha256(proof)
  const code = url.searchParams.get('code')
  let next: Session
  if (!code || url.searchParams.get('error')) next = { status: 'failed', port: session.port, pollHash: session.pollHash, proofHash, reason: 'denied' }
  else {
    try {
      const result = await exchange(fetcher, env, code)
      next = { status: 'ready', port: session.port, pollHash: session.pollHash, proofHash, sealed: await seal(env, result.token, sessionId), expiresAt: result.expiresAt, scopes: result.scopes }
    } catch { next = { status: 'failed', port: session.port, pollHash: session.pollHash, proofHash, reason: 'exchange_failed' } }
  }
  await env.SESSIONS.put(sessionKey(sessionId), JSON.stringify(next), { expirationTtl: READY_TTL_S })
  return backToApp(session.port, { session: sessionId, proof, ...(next.status === 'failed' ? { error: next.reason } : {}) })
}

export async function redeem(env: BrokerEnv, sessionId: string, authorization: string | null, body: unknown) {
  const pollToken = authorization?.match(/^Bearer ([\w-]{20,128})$/)?.[1]
  const proof = (body as { proof?: unknown } | null)?.proof
  if (!pollToken || typeof proof !== 'string' || !/^[\w-]{20,128}$/.test(proof) || !/^[\w-]{10,64}$/.test(sessionId)) return fail(400, 'invalid_request')
  const raw = await env.SESSIONS.get(sessionKey(sessionId))
  const session = raw ? JSON.parse(raw) as Session : null
  if (!session) return fail(404, 'expired')
  if (!sameText(session.pollHash, await sha256(pollToken))) return fail(403, 'forbidden')
  if (session.status === 'pending') return fail(409, 'pending')
  if (!sameText(session.proofHash, await sha256(proof))) return fail(403, 'forbidden')
  await env.SESSIONS.delete(sessionKey(sessionId))
  if (session.status === 'failed') return fail(422, session.reason)
  return json({ accessToken: await unseal(env, session.sealed, sessionId), expiresAt: session.expiresAt, scopes: session.scopes })
}

export async function handle(request: Request, env: BrokerEnv, fetcher: FetchLike = (input, init) => fetch(input, init)) {
  const url = new URL(request.url)
  const body = async () => { try { return await request.json() } catch { return null } }
  if (request.method === 'POST' && url.pathname === '/v1/facebook/sessions') return startSession(env, await body())
  if (request.method === 'GET' && url.pathname === '/v1/facebook/callback') return callback(env, url, fetcher)
  const redeemPath = url.pathname.match(/^\/v1\/facebook\/sessions\/([\w-]+)\/token$/)
  if (request.method === 'POST' && redeemPath) return redeem(env, redeemPath[1], request.headers.get('authorization'), await body())
  return fail(404, 'not_found')
}

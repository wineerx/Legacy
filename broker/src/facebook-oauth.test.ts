import { describe, expect, it, vi } from 'vitest'
import { handle, SCOPES, type BrokerEnv, type FetchLike } from './facebook-oauth'

function env(): BrokerEnv & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store, FB_APP_ID: '1234', FB_APP_SECRET: 'app-secret', PUBLIC_ORIGIN: 'https://broker.test', GRAPH_VERSION: 'v25.0',
    SESSION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    SESSIONS: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v) }, delete: async k => { store.delete(k) } }
  }
}
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body })
const meta = (): FetchLike & ReturnType<typeof vi.fn> => vi.fn((url: string) => {
  if (url.includes('fb_exchange_token=')) return ok({ access_token: 'long-token', expires_in: 5_184_000 })
  if (url.includes('/oauth/access_token')) return ok({ access_token: 'short-token' })
  if (url.endsWith('/me/permissions')) return ok({ data: [{ permission: 'instagram_basic', status: 'granted' }, { permission: 'pages_show_list', status: 'declined' }] })
  return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: {} }) })
}) as never

async function start(e: BrokerEnv, port = 51234) {
  const res = await handle(new Request('https://broker.test/v1/facebook/sessions', { method: 'POST', body: JSON.stringify({ loopbackPort: port }) }), e)
  return { res, body: await res.json() as { sessionId: string; pollToken: string; authorizeUrl: string } }
}
async function authorize(e: BrokerEnv, authorizeUrl: string, fetcher: FetchLike, extra = 'code=abc') {
  const state = new URL(authorizeUrl).searchParams.get('state')
  const res = await handle(new Request(`https://broker.test/v1/facebook/callback?state=${state}&${extra}`), e, fetcher)
  return { res, back: new URL(res.headers.get('location') ?? 'http://invalid/') }
}
const redeem = (e: BrokerEnv, id: string, poll: string, proof: string) =>
  handle(new Request(`https://broker.test/v1/facebook/sessions/${id}/token`, { method: 'POST', headers: { authorization: `Bearer ${poll}` }, body: JSON.stringify({ proof }) }), e)

describe('broker Facebook Login', () => {
  it('abre a autorização com os escopos pedidos e callback do broker, sem segredo na URL', async () => {
    const e = env(); const { res, body } = await start(e)
    expect(res.status).toBe(200)
    const url = new URL(body.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v25.0/dialog/oauth')
    expect(url.searchParams.get('scope')).toBe(SCOPES.join(','))
    expect(url.searchParams.get('redirect_uri')).toBe('https://broker.test/v1/facebook/callback')
    expect(body.authorizeUrl).not.toContain('app-secret')
    expect(body.authorizeUrl).not.toContain(body.pollToken)
    expect([...e.store.values()].join()).not.toContain(body.pollToken)
  })

  it('recusa porta de retorno fora do intervalo', async () => {
    expect((await start(env(), 80)).res.status).toBe(400)
  })

  it('troca o código por token longo, devolve ao loopback com prova e entrega o token uma única vez', async () => {
    const e = env(); const fetcher = meta(); const { body } = await start(e)
    const { res, back } = await authorize(e, body.authorizeUrl, fetcher)
    expect(res.status).toBe(302)
    expect(back.origin).toBe('http://127.0.0.1:51234')
    expect(back.toString()).not.toContain('long-token')
    expect([...e.store.values()].join()).not.toContain('long-token')
    const proof = back.searchParams.get('proof')!
    const first = await redeem(e, body.sessionId, body.pollToken, proof)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ accessToken: 'long-token', scopes: ['instagram_basic'] })
    expect(fetcher.mock.calls.find(c => String(c[0]).endsWith('/me/permissions'))?.[1]).toEqual({ headers: { Authorization: 'Bearer long-token' } })
    expect((await redeem(e, body.sessionId, body.pollToken, proof)).status).toBe(404)
  })

  it('não entrega o token sem a prova do loopback, mesmo com o poll token', async () => {
    const e = env(); const { body } = await start(e)
    await authorize(e, body.authorizeUrl, meta())
    expect((await redeem(e, body.sessionId, body.pollToken, 'x'.repeat(43))).status).toBe(403)
    expect((await redeem(e, body.sessionId, 'y'.repeat(43), 'x'.repeat(43))).status).toBe(403)
  })

  it('responde pendente antes do callback e recusa callback repetido', async () => {
    const e = env(); const { body } = await start(e)
    expect((await redeem(e, body.sessionId, body.pollToken, 'x'.repeat(43))).status).toBe(409)
    await authorize(e, body.authorizeUrl, meta())
    expect((await authorize(e, body.authorizeUrl, meta())).res.status).toBe(400)
  })

  it('informa recusa da pessoa sem chamar a Meta', async () => {
    const e = env(); const fetcher = meta(); const { body } = await start(e)
    const { back } = await authorize(e, body.authorizeUrl, fetcher, 'error=access_denied')
    expect(back.searchParams.get('error')).toBe('denied')
    expect(fetcher).not.toHaveBeenCalled()
    const res = await redeem(e, body.sessionId, body.pollToken, back.searchParams.get('proof')!)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'denied' })
  })

  it('marca falha de troca quando a Meta recusa o código', async () => {
    const e = env(); const { body } = await start(e)
    const refused: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 100 } }) })
    const { back } = await authorize(e, body.authorizeUrl, refused)
    expect(back.searchParams.get('error')).toBe('exchange_failed')
  })
})

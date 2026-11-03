import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { decryptSecret } from './integrations'
import { instagramAccounts } from './instagram-publishing'
import { beginFacebookLogin, discoverFacebookAccounts, finishFacebookLogin, loopbackListener, REQUIRED_SCOPES, type BrokerFetch } from './facebook-login'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
const pages = { data: [
  { name: 'Página A', instagram_business_account: { id: '1784', username: 'conta_a' } },
  { name: 'Sem Instagram' },
  { name: 'Página A duplicada', instagram_business_account: { id: '1784', username: 'conta_a' } }
] }
const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
function broker(redeem: unknown = { accessToken: 'long-lived-user-token', expiresAt: '2026-12-04T00:00:00.000Z', scopes: REQUIRED_SCOPES }, status = 200) {
  return vi.fn<BrokerFetch>((url) => url.endsWith('/v1/facebook/sessions')
    ? reply({ sessionId: 'sess-123456789012', pollToken: 'p'.repeat(43), authorizeUrl: 'https://www.facebook.com/v25.0/dialog/oauth?state=s' })
    : reply(redeem, status))
}
const listen = () => vi.fn(async () => ({ port: 51234, proof: Promise.resolve('q'.repeat(43)), close: vi.fn() }))

describe('Facebook Login pelo broker', () => {
  let ctx: Ctx; let ws: string
  beforeEach(() => {
    ctx = { db: memDb(), dataRoot: 'C:/test', clock: () => new Date('2026-10-05T12:00:00Z') }
    ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
    ctx.secret = (w, key) => decryptSecret(ctx, vault, w, key)
  })

  it('abre o navegador, resgata com poll token e prova, descobre a conta pela Página e guarda no cofre', async () => {
    const fetcher = broker(), openExternal = vi.fn().mockResolvedValue(undefined), request = vi.fn().mockResolvedValue(pages)
    const result = await beginFacebookLogin({ brokerUrl: 'https://broker.test', openExternal, fetch: fetcher, request, listen: listen() })
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ loopbackPort: 51234 })
    expect(openExternal).toHaveBeenCalledWith('https://www.facebook.com/v25.0/dialog/oauth?state=s')
    expect(fetcher.mock.calls[1][0]).toBe('https://broker.test/v1/facebook/sessions/sess-123456789012/token')
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe(`Bearer ${'p'.repeat(43)}`)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ proof: 'q'.repeat(43) })
    expect(request).toHaveBeenCalledWith('me/accounts?fields=name,instagram_business_account{id,username}&limit=100', 'long-lived-user-token')
    expect(result.accounts).toEqual([{ id: '1784', username: 'conta_a', pageName: 'Página A' }])
    expect(JSON.stringify(result)).not.toContain('long-lived-user-token')
    const account = finishFacebookLogin(ctx, vault, ws, result.handle, '1784')
    expect(account).toMatchObject({ id: '1784', authKind: 'facebook_login', expiresAt: '2026-12-04T00:00:00.000Z' })
    expect(decryptSecret(ctx, vault, ws, 'instagramToken:1784')).toBe('long-lived-user-token')
    expect(instagramAccounts(ctx, ws)).toMatchObject([{ id: '1784', authKind: 'facebook_login' }])
    expect(() => finishFacebookLogin(ctx, vault, ws, result.handle, '1784')).toThrow(/expirou/)
  })

  it('não envia o e-mail nem dados pessoais ao broker', async () => {
    const fetcher = broker()
    await beginFacebookLogin({ brokerUrl: 'https://broker.test', openExternal: vi.fn().mockResolvedValue(undefined), fetch: fetcher, request: vi.fn().mockResolvedValue(pages), listen: listen() })
    expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/@/)
  })

  it('recusa login com permissão faltando', async () => {
    const fetcher = broker({ accessToken: 'long-lived-user-token', expiresAt: null, scopes: ['instagram_basic'] })
    await expect(beginFacebookLogin({ brokerUrl: 'https://broker.test', openExternal: vi.fn().mockResolvedValue(undefined), fetch: fetcher, request: vi.fn(), listen: listen() }))
      .rejects.toThrow(/instagram_content_publish/)
  })

  it('explica quando nenhuma Página tem Instagram vinculado', async () => {
    await expect(beginFacebookLogin({ brokerUrl: 'https://broker.test', openExternal: vi.fn().mockResolvedValue(undefined), fetch: broker(), request: vi.fn().mockResolvedValue({ data: [{ name: 'Só Página' }] }), listen: listen() }))
      .rejects.toThrow(/Nenhuma Página/)
  })

  it('traduz login cancelado pelo broker', async () => {
    await expect(beginFacebookLogin({ brokerUrl: 'https://broker.test', openExternal: vi.fn().mockResolvedValue(undefined), fetch: broker({ error: 'denied' }, 422), request: vi.fn(), listen: listen() }))
      .rejects.toThrow(/cancelado/)
  })

  it('descobre contas sem repetir a mesma conta de duas Páginas', async () => {
    expect(await discoverFacebookAccounts('t', vi.fn().mockResolvedValue(pages))).toHaveLength(1)
  })

  it('o listener local só aceita o retorno da sessão atual', async () => {
    const l = await loopbackListener(() => 'sess-abc')
    try {
      expect((await fetch(`http://127.0.0.1:${l.port}/facebook/callback?session=outra&proof=${'z'.repeat(43)}`)).status).toBe(404)
      expect((await fetch(`http://127.0.0.1:${l.port}/facebook/callback?session=sess-abc&proof=${'z'.repeat(43)}`)).status).toBe(200)
      expect(await l.proof).toBe('z'.repeat(43))
    } finally { l.close() }
  })
})

import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { instagramJson } from './instagram-publishing'

vi.mock('../diagnostics', async importOriginal => {
  const original = await importOriginal<typeof import('../diagnostics')>()
  return { ...original, diagnosticRequest: (_url: unknown, _opts: unknown, callback: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(): void }
    req.end = () => queueMicrotask(() => {
      const res = Object.assign(new EventEmitter(), { statusCode: 400, headers: {}, setEncoding() {} })
      callback(res)
      res.emit('data', JSON.stringify({ error: { code: 9, error_subcode: 2207042, type: 'OAuthException' } }))
      res.emit('end')
    })
    return req
  } }
})

it('carries the actual Meta error_subcode from the HTTP response into the typed quota error', async () => {
  await expect(instagramJson('123/media_publish', 'private-test-token', { creation_id: '456' }))
    .rejects.toMatchObject({ status: 400, apiCode: 9, apiSubcode: 2207042, publicationLimited: true, retryable: true })
})

it('with the provider network switched off, no socket is opened and the caller gets a transient error', async () => {
  const diagnostics = await import('../diagnostics')
  const spy = vi.spyOn(diagnostics, 'diagnosticRequest')
  process.env.LEGACY_PROVIDER_NETWORK = 'off'
  try {
    await expect(instagramJson('123/content_publishing_limit?fields=quota_usage,config', 'private-test-token')).rejects.toMatchObject({ code: 'internal', message: 'Rede de provedores desativada neste ambiente.' })
    expect(spy).not.toHaveBeenCalled()
  } finally { delete process.env.LEGACY_PROVIDER_NETWORK; spy.mockRestore() }
})

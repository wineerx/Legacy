import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginShutdown, exposeForJob, releaseAll, releaseExpired, releaseExposure, resetRegistryForTests, SHARE_TTL_MS } from './registry'
import type { MediaHost } from './types'

const fakeHost = () => { const release = vi.fn().mockResolvedValue(undefined); const host: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'https://h/x', release }) }; return { host, release } }
const prepared = () => { const cleanup = vi.fn(); return { prepare: vi.fn().mockResolvedValue({ path: 'C:/tmp/c.mp4', cleanup }), cleanup } }
afterEach(async () => { await releaseAll().catch(() => undefined); resetRegistryForTests() })

describe('registro de exposição', () => {
  it('reaproveita a exposição do mesmo job e libera com limpeza da cópia', async () => {
    const { host, release } = fakeHost(); const { prepare, cleanup } = prepared()
    expect(await exposeForJob('j1', prepare, host)).toBe('https://h/x')
    expect(await exposeForJob('j1', prepare, host)).toBe('https://h/x')
    expect(host.expose).toHaveBeenCalledTimes(1)
    await releaseExposure('j1'); expect(release).toHaveBeenCalled(); expect(cleanup).toHaveBeenCalled()
  })
  it('falha ao expor apaga a cópia', async () => {
    const { prepare, cleanup } = prepared()
    const host: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockRejectedValue(new Error('x')) }
    await expect(exposeForJob('j2', prepare, host)).rejects.toThrow('x'); expect(cleanup).toHaveBeenCalled()
  })
  it('releaseExpired encerra exposições além do TTL', async () => {
    const { host, release } = fakeHost(); const { prepare } = prepared()
    await exposeForJob('j3', prepare, host, 0)
    await releaseExpired(SHARE_TTL_MS - 1); expect(release).not.toHaveBeenCalled()
    await releaseExpired(SHARE_TTL_MS + 1); expect(release).toHaveBeenCalled()
  })
  it('chamadas concorrentes do mesmo job expõem uma vez', async () => {
    const { host } = fakeHost(); const { prepare } = prepared()
    const [a, b] = await Promise.all([exposeForJob('jX', prepare, host), exposeForJob('jX', prepare, host)])
    expect(a).toBe('https://h/x'); expect(b).toBe(a)
    expect(host.expose).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(1)
  })
  it('releaseAll libera todas mesmo se uma falhar', async () => {
    const r1 = vi.fn().mockRejectedValue(new Error('boom')); const r2 = vi.fn().mockResolvedValue(undefined)
    const h1: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'u1', release: r1 }) }
    const h2: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'u2', release: r2 }) }
    const p1 = prepared(); const p2 = prepared()
    await exposeForJob('k1', p1.prepare, h1); await exposeForJob('k2', p2.prepare, h2)
    await expect(releaseAll()).rejects.toThrow('boom')
    expect(r2).toHaveBeenCalled(); expect(p1.cleanup).toHaveBeenCalled(); expect(p2.cleanup).toHaveBeenCalled()
  })
  it('releaseExpired libera todas mesmo se uma falhar', async () => {
    const r1 = vi.fn().mockRejectedValue(new Error('boom')); const r2 = vi.fn().mockResolvedValue(undefined)
    const h1: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'u1', release: r1 }) }
    const h2: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn().mockResolvedValue({ url: 'u2', release: r2 }) }
    await exposeForJob('e1', prepared().prepare, h1, 0); await exposeForJob('e2', prepared().prepare, h2, 0)
    await expect(releaseExpired(SHARE_TTL_MS + 1)).rejects.toThrow('boom')
    expect(r2).toHaveBeenCalled()
  })
  it('exposição expirada é liberada e recriada', async () => {
    const { host, release } = fakeHost(); const { prepare, cleanup } = prepared()
    await exposeForJob('x1', prepare, host, 0)
    await exposeForJob('x1', prepare, host, SHARE_TTL_MS + 1)
    expect(release).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1)
    expect(host.expose).toHaveBeenCalledTimes(2)
  })
  it('exposição em andamento que termina após beginShutdown é liberada e rejeitada', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    let resolveExpose: (v: { url: string; release: () => Promise<void> }) => void = () => {}
    const host: MediaHost = { id: 'cloudflare-quick-tunnel', expose: vi.fn(() => new Promise<{ url: string; release: () => Promise<void> }>((r) => { resolveExpose = r })) }
    const { prepare, cleanup } = prepared()
    const run = exposeForJob('s1', prepare, host)
    await vi.waitFor(() => expect(host.expose).toHaveBeenCalled())
    beginShutdown()
    await releaseAll()
    resolveExpose({ url: 'https://h/s', release })
    await expect(run).rejects.toMatchObject({ code: 'internal' })
    expect(release).toHaveBeenCalled(); expect(cleanup).toHaveBeenCalled()
  })
  it('cópia pronta após beginShutdown é apagada sem abrir o túnel', async () => {
    const { host } = fakeHost(); const cleanup = vi.fn()
    let resolvePrep: (v: { path: string; cleanup: () => void }) => void = () => {}
    const prepare = vi.fn(() => new Promise<{ path: string; cleanup: () => void }>((r) => { resolvePrep = r }))
    const run = exposeForJob('s2', prepare, host)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalled())
    beginShutdown(); resolvePrep({ path: 'C:/tmp/c.mp4', cleanup })
    await expect(run).rejects.toMatchObject({ code: 'internal' })
    expect(cleanup).toHaveBeenCalled(); expect(host.expose).not.toHaveBeenCalled()
  })
  it('novas exposições são recusadas durante o encerramento', async () => {
    const { host } = fakeHost(); const { prepare } = prepared()
    beginShutdown()
    await expect(exposeForJob('s3', prepare, host)).rejects.toMatchObject({ code: 'internal' })
    expect(prepare).not.toHaveBeenCalled(); expect(host.expose).not.toHaveBeenCalled()
  })
  it('estado de encerramento não vaza entre testes', async () => {
    const { host } = fakeHost(); const { prepare } = prepared()
    expect(await exposeForJob('s4', prepare, host)).toBe('https://h/x')
  })
})

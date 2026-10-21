import { describe, expect, it, vi } from 'vitest'
import { makeReachable, quickTunnelHost } from './quick-tunnel'
import { TUNNEL_FAILED } from './tunnel'

const share = () => ({ port: 1234, urlPath: '/tok/video.mp4', close: vi.fn().mockResolvedValue(undefined) })
describe('quickTunnelHost', () => {
  it('compõe URL pública + caminho e libera túnel e servidor', async () => {
    const s = share(); const t = { publicUrl: 'https://a-b.trycloudflare.com', pid: 1, close: vi.fn() }
    const host = quickTunnelHost({ share: vi.fn().mockResolvedValue(s), tunnel: vi.fn().mockResolvedValue(t), reachable: vi.fn().mockResolvedValue(true) })
    const exposed = await host.expose({ jobId: 'j', filePath: 'C:/x.mp4' })
    expect(exposed.url).toBe('https://a-b.trycloudflare.com/tok/video.mp4')
    await exposed.release(); expect(t.close).toHaveBeenCalled(); expect(s.close).toHaveBeenCalled()
  })
  it('URL inalcançável fecha tudo e falha', async () => {
    const s = share(); const t = { publicUrl: 'https://a-b.trycloudflare.com', pid: 1, close: vi.fn() }
    const host = quickTunnelHost({ share: vi.fn().mockResolvedValue(s), tunnel: vi.fn().mockResolvedValue(t), reachable: vi.fn().mockResolvedValue(false) })
    await expect(host.expose({ jobId: 'j', filePath: 'C:/x.mp4' })).rejects.toThrow(TUNNEL_FAILED)
    expect(t.close).toHaveBeenCalled(); expect(s.close).toHaveBeenCalled()
  })
  it('release fecha o servidor mesmo se o túnel falhar ao fechar', async () => {
    const s = share(); const t = { publicUrl: 'https://a-b.trycloudflare.com', pid: 1, close: vi.fn(() => { throw new Error('kill') }) }
    const host = quickTunnelHost({ share: vi.fn().mockResolvedValue(s), tunnel: vi.fn().mockResolvedValue(t), reachable: vi.fn().mockResolvedValue(true) })
    const exposed = await host.expose({ jobId: 'j', filePath: 'C:/x.mp4' })
    await expect(exposed.release()).rejects.toThrow('kill'); expect(s.close).toHaveBeenCalled()
  })
  it('erro de limpeza não mascara o erro original', async () => {
    const s = share(); s.close.mockRejectedValue(new Error('cleanup'))
    const t = { publicUrl: 'https://a-b.trycloudflare.com', pid: 1, close: vi.fn() }
    const host = quickTunnelHost({ share: vi.fn().mockResolvedValue(s), tunnel: vi.fn().mockResolvedValue(t), reachable: vi.fn().mockResolvedValue(false) })
    await expect(host.expose({ jobId: 'j', filePath: 'C:/x.mp4' })).rejects.toThrow(TUNNEL_FAILED)
  })
})

describe('makeReachable', () => {
  const url = 'https://a-b.trycloudflare.com/tok/video.mp4'
  it('espera antes da primeira sonda e só faz HEAD depois que o DNS resolve', async () => {
    const calls: string[] = []
    const resolve4 = vi.fn(async (h: string) => { calls.push('dns:' + h); if (resolve4.mock.calls.length < 3) throw new Error('ENOTFOUND'); return ['1.2.3.4'] })
    const head = vi.fn(async () => { calls.push('head'); return true })
    const sleep = vi.fn(async (ms: number) => { calls.push('sleep:' + ms) })
    expect(await makeReachable({ resolve4, head, sleep })(url)).toBe(true)
    expect(calls[0]).toBe('sleep:3000')
    expect(calls.filter(c => c === 'dns:a-b.trycloudflare.com')).toHaveLength(3)
    expect(head).toHaveBeenCalledTimes(1); expect(calls.at(-1)).toBe('head')
  })
  it('desiste depois do orçamento de tentativas sem fazer HEAD se o DNS nunca resolve', async () => {
    const resolve4 = vi.fn().mockRejectedValue(new Error('ENOTFOUND')); const head = vi.fn().mockResolvedValue(true)
    expect(await makeReachable({ resolve4, head, sleep: vi.fn().mockResolvedValue(undefined), attempts: 4 })(url)).toBe(false)
    expect(resolve4).toHaveBeenCalledTimes(4); expect(head).not.toHaveBeenCalled()
  })
  it('repete o HEAD quando a resposta ainda não é ok', async () => {
    const head = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('reset')).mockResolvedValueOnce(true)
    expect(await makeReachable({ resolve4: vi.fn().mockResolvedValue(['1.2.3.4']), head, sleep: vi.fn().mockResolvedValue(undefined) })(url)).toBe(true)
    expect(head).toHaveBeenCalledTimes(3)
  })
})

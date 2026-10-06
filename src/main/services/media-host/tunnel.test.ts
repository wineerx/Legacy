import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeAllTunnels, openTunnel, TUNNEL_FAILED } from './tunnel'

const dir = mkdtempSync(join(tmpdir(), 'legacy-tunnel-'))
const script = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, body); return p }
const prints = script('prints.cjs', `process.stderr.write('INF | https://quiet-river-ab12.trycloudflare.com |\\nargs: ' + process.argv.slice(2).join(' ') + '\\n'); setInterval(() => {}, 1000)`)
const printApiFirst = script('printApiFirst.cjs', `process.stderr.write('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": ...\\n'); process.stderr.write('INF | https://real-tunnel-ab12.trycloudflare.com |\\n'); setInterval(() => {}, 1000)`)
const apiOnly = script('apiOnly.cjs', `process.stderr.write('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": ...\\n'); process.exit(1)`)
const silent = script('silent.cjs', 'setInterval(() => {}, 1000)')
const exits = script('exits.cjs', 'process.exit(1)')
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('openTunnel', () => {
  it('extrai a URL trycloudflare e encerra o processo no close', async () => {
    const t = await openTunnel(4321, { bin: process.execPath, prefixArgs: [prints] })
    expect(t.publicUrl).toBe('https://quiet-river-ab12.trycloudflare.com')
    expect(t.pid).toBeDefined()
    t.close(); await new Promise(r => setTimeout(r, 300))
    expect(alive(t.pid!)).toBe(false)
  })
  it('ignora api.trycloudflare.com nos logs e aguarda a URL real', async () => {
    const t = await openTunnel(4321, { bin: process.execPath, prefixArgs: [printApiFirst] })
    expect(t.publicUrl).toBe('https://real-tunnel-ab12.trycloudflare.com')
    t.close(); await new Promise(r => setTimeout(r, 300))
    expect(alive(t.pid!)).toBe(false)
  })
  it('falha quando só recebe api.trycloudflare.com e o processo sai', async () => {
    await expect(openTunnel(4321, { bin: process.execPath, prefixArgs: [apiOnly], timeoutMs: 500 })).rejects.toThrow(TUNNEL_FAILED)
  })
  it('falha com timeout quando não recebe URL', async () => {
    await expect(openTunnel(4321, { bin: process.execPath, prefixArgs: [silent], timeoutMs: 300 })).rejects.toThrow(TUNNEL_FAILED)
  })
  it('falha quando o processo sai', async () => {
    await expect(openTunnel(4321, { bin: process.execPath, prefixArgs: [exits] })).rejects.toThrow(TUNNEL_FAILED)
  })
  it('closeAllTunnels encerra túneis abertos e os que ainda aguardam a URL', async () => {
    const t = await openTunnel(4321, { bin: process.execPath, prefixArgs: [prints] })
    const waiting = openTunnel(4321, { bin: process.execPath, prefixArgs: [silent], timeoutMs: 10_000 })
    await new Promise(r => setTimeout(r, 300))
    closeAllTunnels()
    await expect(waiting).rejects.toThrow(TUNNEL_FAILED)
    await new Promise(r => setTimeout(r, 300))
    expect(alive(t.pid!)).toBe(false)
  })
})

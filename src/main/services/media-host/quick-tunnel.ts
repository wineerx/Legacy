import { promises as dnsPromises } from 'node:dns'
import { AppError } from '@shared/errors'
import { cloudflaredPath } from '../../media/ffmpeg-bin'
import { shareFile, type FileShare } from './file-share'
import { openTunnel, TUNNEL_FAILED, type Tunnel } from './tunnel'
import type { MediaHost } from './types'

type ReachDeps = { resolve4: (host: string) => Promise<string[]>; head: (url: string) => Promise<boolean>; sleep: (ms: number) => Promise<void>; attempts?: number }
const reachDefaults: ReachDeps = {
  // c-ares lookup bypasses the Windows DNS client, which caches the NXDOMAIN of a hostname probed too early.
  resolve4: (host) => dnsPromises.resolve4(host),
  head: async (url) => (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })).ok,
  sleep: (ms) => new Promise(r => setTimeout(r, ms))
}

// New trycloudflare hostnames take a few seconds to resolve: warm up, then probe only after DNS answers.
export function makeReachable(deps: ReachDeps = reachDefaults): (url: string) => Promise<boolean> {
  return async (url) => {
    const host = new URL(url).hostname
    await deps.sleep(3000)
    const attempts = deps.attempts ?? 10
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await deps.sleep(2000)
      try { await deps.resolve4(host) } catch { continue }
      try { if (await deps.head(url)) return true } catch { /* retry */ }
    }
    return false
  }
}

type Deps = { share: (path: string) => Promise<FileShare>; tunnel: (port: number) => Promise<Tunnel>; reachable: (url: string) => Promise<boolean> }
const defaults: Deps = { share: shareFile, tunnel: (port) => openTunnel(port, { bin: cloudflaredPath() }), reachable: makeReachable() }

export function quickTunnelHost(deps: Deps = defaults): MediaHost {
  return {
    id: 'cloudflare-quick-tunnel',
    async expose({ filePath }) {
      const share = await deps.share(filePath)
      let tunnel: Tunnel | undefined
      try {
        tunnel = await deps.tunnel(share.port)
        const url = tunnel.publicUrl + share.urlPath
        if (!(await deps.reachable(url))) throw new AppError('internal', TUNNEL_FAILED)
        const opened = tunnel
        return { url, release: async () => { try { opened.close() } finally { await share.close() } } }
      } catch (e) {
        try { tunnel?.close() } catch { /* keep original error */ }
        await share.close().catch(() => undefined)
        throw e
      }
    }
  }
}

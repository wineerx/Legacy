import { spawn } from 'node:child_process'
import { AppError } from '@shared/errors'

export const TUNNEL_FAILED = 'Não foi possível abrir o link temporário. Confira a conexão e tente de novo.'
export interface Tunnel { publicUrl: string; pid: number | undefined; close(): void }
const URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/
const live = new Set<() => void>()

// Worker stop: kill every cloudflared this process started, including ones still waiting for their URL.
export function closeAllTunnels(): void { for (const close of [...live]) { try { close() } catch { /* best effort */ } } }

// Quick tunnel: no account or key. The URL is never logged.
export async function openTunnel(port: number, opts: { bin: string; prefixArgs?: string[]; timeoutMs?: number }): Promise<Tunnel> {
  const child = spawn(opts.bin, [...(opts.prefixArgs ?? []), 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const close = () => { live.delete(close); if (child.exitCode === null && child.signalCode === null) child.kill() }
  live.add(close)
  child.once('exit', () => live.delete(close))
  try {
    const publicUrl = await new Promise<string>((resolve, reject) => {
      let buf = ''
      const fail = () => { clearTimeout(timer); reject(new AppError('internal', TUNNEL_FAILED)) }
      const timer = setTimeout(fail, opts.timeoutMs ?? 30_000)
      const onData = (d: Buffer) => { buf = (buf + d.toString()).slice(-8000); const m = URL_RE.exec(buf); if (m) { clearTimeout(timer); resolve(m[0]) } }
      child.stdout!.on('data', onData); child.stderr!.on('data', onData)
      child.once('error', fail); child.once('exit', fail)
    })
    return { publicUrl, pid: child.pid, close }
  } catch (e) { close(); throw e }
}

import { spawn } from 'node:child_process'
import { AppError } from '@shared/errors'

export function runTool(
  bin: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true, signal: opts.signal })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeoutMs = opts.timeoutMs ?? 600_000
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20_000) })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); reject(new AppError('ffmpeg_failed', e.message)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return reject(new AppError('ffmpeg_failed', `Processamento excedeu o tempo limite de ${Math.round(timeoutMs / 1000)} s.`))
      if (code === 0) return resolvePromise({ stdout, stderr })
      const tail = stderr.trim().split(/\r?\n/).slice(-4).join(' | ')
      reject(new AppError('ffmpeg_failed', `Processamento falhou (código ${code}): ${tail}`))
    })
  })
}

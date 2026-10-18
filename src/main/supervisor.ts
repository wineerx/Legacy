import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { WorkerEvent } from './worker/handlers'
import type { SecretMap } from './services/integrations'

export function startWorker(opts: { dbPath: string; dataRoot: string; migrationsDir: string; ffmpegDir?: string; onEvent: (e: WorkerEvent) => void; initiallyPaused?: boolean; credentials?(): SecretMap }) {
  let child: UtilityProcess | null = null
  let stopped = false
  let paused = opts.initiallyPaused ?? false
  let pauseRequest = 0
  const pendingPauses = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const finishPauses = () => { for (const pending of pendingPauses.values()) { clearTimeout(pending.timer); pending.resolve() }; pendingPauses.clear() }
  let delay = 1000
  let timer: ReturnType<typeof setTimeout> | null = null

  const spawn = () => {
    if (stopped) return
    const startedAt = Date.now()
    child = utilityProcess.fork(join(import.meta.dirname, 'worker.js'), [], {
      serviceName: 'Legacy worker',
      env: {
        ...process.env,
        LEGACY_DB_PATH: opts.dbPath, LEGACY_DATA_DIR: opts.dataRoot, LEGACY_MIGRATIONS_DIR: opts.migrationsDir,
        LEGACY_MANAGED_SECRETS: '1', LEGACY_WORKER_PAUSED: paused ? '1' : '0',
        ...(opts.ffmpegDir ? { LEGACY_FFMPEG_DIR: opts.ffmpegDir } : {})
      }
    })
    const spawned = child
    child.on('message', (m) => {
      if (m && typeof m === 'object' && (m as { type?: string }).type === 'credentials-ready') {
        spawned.postMessage({ type: 'pause', paused })
        for (const requestId of pendingPauses.keys()) spawned.postMessage({ type: 'pause', paused, requestId })
        spawned.postMessage({ type: 'credentials', secrets: opts.credentials?.() ?? {} })
      } else if (m && typeof m === 'object' && (m as { type?: string }).type === 'pause-applied') {
        const id = (m as { requestId: number }).requestId
        const pending = pendingPauses.get(id)
        if (pending) { clearTimeout(pending.timer); pending.resolve(); pendingPauses.delete(id) }
      } else opts.onEvent(m as WorkerEvent)
    })
    child.on('error', (e) => console.error('[supervisor] worker error', e))
    child.on('exit', () => {
      child = null
      finishPauses() // A replacement inherits the latest pause before accepting jobs.
      if (stopped) return
      if (Date.now() - startedAt >= 30_000) delay = 1000
      timer = setTimeout(spawn, delay)
      delay = Math.min(delay * 2, 30_000)
    })
  }
  spawn()

  return {
    setPaused: (value: boolean): Promise<void> => {
      paused = value
      if (!child) return Promise.resolve()
      const requestId = ++pauseRequest
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pendingPauses.delete(requestId); reject(new Error('O worker não confirmou a alteração da pausa.')) }, 5000)
        pendingPauses.set(requestId, { resolve, reject, timer })
        child!.postMessage({ type: 'pause', paused, requestId })
      })
    },
    updateSecrets: () => child?.postMessage({ type: 'credentials', secrets: opts.credentials?.() ?? {} }),
    isAlive: () => child !== null,
    stop: () => new Promise<void>((resolve) => {
      stopped = true
      finishPauses()
      if (timer) { clearTimeout(timer); timer = null }
      if (!child) return resolve()
      const c = child
      const killTimer = setTimeout(() => { c.kill(); resolve() }, 5000)
      c.once('exit', () => { clearTimeout(killTimer); resolve() })
      c.postMessage({ type: 'stop' })
    })
  }
}

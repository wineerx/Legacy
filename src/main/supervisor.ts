import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { WorkerEvent } from './worker/handlers'
import type { SecretMap } from './services/integrations'

export function startWorker(opts: { dbPath: string; dataRoot: string; migrationsDir: string; ffmpegDir?: string; onEvent: (e: WorkerEvent) => void; credentials?(): SecretMap }) {
  let child: UtilityProcess | null = null
  let stopped = false
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
        LEGACY_MANAGED_SECRETS: '1',
        ...(opts.ffmpegDir ? { LEGACY_FFMPEG_DIR: opts.ffmpegDir } : {})
      }
    })
    const spawned = child
    child.on('message', (m) => {
      if (m && typeof m === 'object' && (m as { type?: string }).type === 'credentials-ready') {
        spawned.postMessage({ type: 'credentials', secrets: opts.credentials?.() ?? {} })
      } else opts.onEvent(m as WorkerEvent)
    })
    child.on('error', (e) => console.error('[supervisor] worker error', e))
    child.on('exit', () => {
      child = null
      if (stopped) return
      if (Date.now() - startedAt >= 30_000) delay = 1000
      timer = setTimeout(spawn, delay)
      delay = Math.min(delay * 2, 30_000)
    })
  }
  spawn()

  return {
    updateSecrets: () => child?.postMessage({ type: 'credentials', secrets: opts.credentials?.() ?? {} }),
    isAlive: () => child !== null,
    stop: () => new Promise<void>((resolve) => {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
      if (!child) return resolve()
      const c = child
      const killTimer = setTimeout(() => { c.kill(); resolve() }, 5000)
      c.once('exit', () => { clearTimeout(killTimer); resolve() })
      c.postMessage({ type: 'stop' })
    })
  }
}

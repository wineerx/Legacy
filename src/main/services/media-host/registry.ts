import { AppError } from '@shared/errors'
import type { PreparedCopy } from '../../media/publish-prep'
import { quickTunnelHost } from './quick-tunnel'
import type { ExposedMedia, MediaHost } from './types'

export const SHARE_TTL_MS = 15 * 60_000
type Entry = { exposed: ExposedMedia; copy: PreparedCopy; startedAt: number }
const active = new Map<string, Entry>()

export function defaultMediaHost(): MediaHost { return quickTunnelHost() }

const pending = new Map<string, Promise<string>>()
let closing = false
const SHUTTING_DOWN = 'Publicação interrompida porque o Legacy está fechando. Ela será retomada depois.'

// Called when the worker is asked to stop: in-flight exposures release themselves as soon as they resolve.
export function beginShutdown(): void { closing = true }
export function resetRegistryForTests(): void { closing = false; active.clear(); pending.clear() }

// Keeps one exposure per job alive across status polls inside the worker process.
export async function exposeForJob(jobId: string, prepare: () => Promise<PreparedCopy>, host: MediaHost, now = Date.now()): Promise<string> {
  if (closing) throw new AppError('internal', SHUTTING_DOWN)
  const inflight = pending.get(jobId)
  if (inflight) return inflight
  const current = active.get(jobId)
  if (current) {
    if (now - current.startedAt <= SHARE_TTL_MS) return current.exposed.url
    await releaseExposure(jobId)
    const again = pending.get(jobId)
    if (again) return again
  }
  const run = (async () => {
    const copy = await prepare()
    if (closing) { copy.cleanup(); throw new AppError('internal', SHUTTING_DOWN) }
    try {
      const exposed = await host.expose({ jobId, filePath: copy.path })
      if (closing) {
        try { await exposed.release() } finally { copy.cleanup() }
        throw new AppError('internal', SHUTTING_DOWN)
      }
      active.set(jobId, { exposed, copy, startedAt: now })
      return exposed.url
    } catch (e) { try { copy.cleanup() } catch { /* keep original error */ } throw e }
  })()
  pending.set(jobId, run)
  try { return await run } finally { pending.delete(jobId) }
}
export async function releaseExposure(jobId: string): Promise<void> {
  const entry = active.get(jobId)
  if (!entry) return
  active.delete(jobId)
  try { await entry.exposed.release() } finally { entry.copy.cleanup() }
}
async function releaseMany(jobIds: string[]): Promise<void> {
  const results = await Promise.allSettled(jobIds.map((id) => releaseExposure(id)))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
}
export async function releaseExpired(now = Date.now()): Promise<void> {
  await releaseMany([...active].filter(([, e]) => now - e.startedAt > SHARE_TTL_MS).map(([id]) => id))
}
export async function releaseAll(): Promise<void> {
  await releaseMany([...active.keys()])
}

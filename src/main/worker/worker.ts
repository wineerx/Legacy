import { openDb } from '../db/client'
import { recoverExpired } from '../queue/queue'
import { processNext, maybeRecover, type WorkerEvent } from './handlers'
import type { Ctx } from '../context'
import type { SecretMap } from '../services/integrations'
import { beginShutdown, releaseAll, releaseExpired } from '../services/media-host/registry'
import { closeAllTunnels } from '../services/media-host/tunnel'
import { sweepPublishTmp } from '../services/publish-tmp'

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`Variável ${k} ausente no worker`)
  return v
}

const { db, close } = openDb(env('LEGACY_DB_PATH'), env('LEGACY_MIGRATIONS_DIR'))
let secrets: SecretMap = {}
const ctx: Ctx = { db, dataRoot: env('LEGACY_DATA_DIR'), clock: () => new Date(), secret: (ws, key) => secrets[ws]?.[key] ?? null }
const parent = (process as NodeJS.Process & { parentPort?: { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: unknown }) => void): void } }).parentPort
const notify = (e: WorkerEvent) => parent?.postMessage(e)

let stopping = false
let paused = process.env.LEGACY_WORKER_PAUSED === '1'
let credentialsReady: () => void = () => {}
const ready = process.env.LEGACY_MANAGED_SECRETS === '1' ? new Promise<void>((resolve) => { credentialsReady = resolve }) : Promise.resolve()
parent?.on('message', (e) => {
  const data = e.data as { type?: string; secrets?: SecretMap; paused?: boolean }
  if (data?.type === 'stop') {
    stopping = true; credentialsReady()
    // The supervisor kills the worker 5 s after 'stop'; release tunnels and copies now instead of after the current job.
    beginShutdown()
    void releaseAll().catch((err) => console.error('[worker] release', err))
    closeAllTunnels()
  }
  if (data?.type === 'pause') paused = data.paused === true
  if (data?.type === 'credentials') { secrets = data.secrets ?? {}; credentialsReady() }
})
// Announce readiness only after the message listener and database are initialized.
if (process.env.LEGACY_MANAGED_SECRETS === '1') parent?.postMessage({ type: 'credentials-ready' })

recoverExpired(db, new Date())
try { sweepPublishTmp(ctx) } catch (e) { console.error('[worker] sweep', e) }
let lastRecover = Date.now()

async function loop(): Promise<void> {
  await ready
  while (!stopping) {
    // Give parent pause messages a turn between jobs, including jobs with synchronous handlers.
    await new Promise<void>(resolve => setImmediate(resolve))
    let worked = false
    try {
      if (!paused) worked = await processNext(ctx, notify)
    } catch (e) {
      console.error('[worker]', e)
    }
    if (!worked) {
      await releaseExpired().catch((e) => console.error('[worker] release', e))
      try { lastRecover = maybeRecover(ctx, lastRecover, Date.now(), 15_000) } catch (e) { console.error('[worker] recover', e) }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  await releaseAll().catch((e) => console.error('[worker] release', e))
  close()
  process.exit(0)
}

void loop()

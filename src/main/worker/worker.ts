import { openDb } from '../db/client'
import { recoverExpired } from '../queue/queue'
import { processNext, maybeRecover, type WorkerEvent } from './handlers'
import type { Ctx } from '../context'
import type { SecretMap } from '../services/integrations'

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
let credentialsReady: () => void = () => {}
const ready = process.env.LEGACY_MANAGED_SECRETS === '1' ? new Promise<void>((resolve) => { credentialsReady = resolve }) : Promise.resolve()
parent?.on('message', (e) => {
  const data = e.data as { type?: string; secrets?: SecretMap }
  if (data?.type === 'stop') { stopping = true; credentialsReady() }
  if (data?.type === 'credentials') { secrets = data.secrets ?? {}; credentialsReady() }
})
// Announce readiness only after the message listener and database are initialized.
if (process.env.LEGACY_MANAGED_SECRETS === '1') parent?.postMessage({ type: 'credentials-ready' })

recoverExpired(db, new Date())
let lastRecover = Date.now()

async function loop(): Promise<void> {
  await ready
  while (!stopping) {
    let worked = false
    try {
      worked = await processNext(ctx, notify)
    } catch (e) {
      console.error('[worker]', e)
    }
    if (!worked) {
      try { lastRecover = maybeRecover(ctx, lastRecover, Date.now(), 15_000) } catch (e) { console.error('[worker] recover', e) }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  close()
  process.exit(0)
}

void loop()

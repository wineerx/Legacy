import { setDiagnosticSink } from '../diagnostics'
import { openDb } from '../db/client'
import { recoverExpired } from '../queue/queue'
import { processNext, maybeRecover, type WorkerEvent } from './handlers'
import type { Ctx } from '../context'
import type { SecretMap } from '../services/integrations'
import { beginShutdown, releaseAll, releaseExpired } from '../services/media-host/registry'
import { closeAllTunnels } from '../services/media-host/tunnel'
import { sweepPublishTmp } from '../services/publish-tmp'
import { pipelineConfig } from '../pipeline-config'
import { sweepProcessedCache, migrateLegacyPublicationRecipes } from '../services/versions'
import { listWorkspaces } from '../repos/workspaces'
import { stopMediaTools } from '../media/run'

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
const renders=new Map<string,{resolve(value:import('@shared/visual-raster').VisualRaster):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}>()
ctx.renderVisual=layout=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>{renders.delete(requestId);reject(new Error('Tempo excedido ao renderizar Template.'))},60000)
  renders.set(requestId,{resolve,reject,timer});parent?.postMessage({type:'visual-render',requestId,layout})
})
setDiagnosticSink(event => parent?.postMessage({ type: 'diagnostic', event }))
const healthTimer = setInterval(() => parent?.postMessage({ type: 'heartbeat', timestamp: new Date().toISOString() }), 2000)
healthTimer.unref()

let stopping = false
let paused = process.env.LEGACY_WORKER_PAUSED === '1'
let credentialsReady: () => void = () => {}
const ready = process.env.LEGACY_MANAGED_SECRETS === '1' ? new Promise<void>((resolve) => { credentialsReady = resolve }) : Promise.resolve()
parent?.on('message', (e) => {
  const visual=e.data as {type?:string;requestId:string;result:import('@shared/visual-raster').VisualRaster;error?:string}
  if(visual.type==='visual-render-result'){const pending=renders.get(visual.requestId);if(pending){clearTimeout(pending.timer);renders.delete(visual.requestId);visual.error?pending.reject(new Error(visual.error)):pending.resolve(visual.result)}return}
  const data = e.data as { type?: string; secrets?: SecretMap; paused?: boolean; requestId?: number }
  if (data?.type === 'stop') {
    for(const pending of renders.values()){clearTimeout(pending.timer);pending.reject(new Error('Worker encerrado.'))}renders.clear()
    stopping = true; credentialsReady()
    stopMediaTools()
    // The supervisor kills the worker 5 s after 'stop'; release tunnels and copies now instead of after the current job.
    beginShutdown()
    void releaseAll().catch((err) => console.error('[worker] release', err))
    closeAllTunnels()
  }
  if (data?.type === 'pause') {
    paused = data.paused === true
    if (data.requestId !== undefined) parent?.postMessage({ type: 'pause-applied', requestId: data.requestId })
  }
  if (data?.type === 'credentials') { secrets = data.secrets ?? {}; credentialsReady() }
})
// Announce readiness only after the message listener and database are initialized.
if (process.env.LEGACY_MANAGED_SECRETS === '1') parent?.postMessage({ type: 'credentials-ready' })

recoverExpired(db, new Date())
migrateLegacyPublicationRecipes(ctx)
try { sweepPublishTmp(ctx) } catch (e) { console.error('[worker] sweep', e) }
let lastRecover = Date.now()
const recoveryTimer=setInterval(() => {
  try {lastRecover=maybeRecover(ctx,lastRecover,Date.now(),15_000)}catch(e){console.error('[worker] recover',e)}
  void releaseExpired().catch(e=>console.error('[worker] release',e))
},15_000)
recoveryTimer.unref()
const cacheReady=Promise.all(listWorkspaces(db).map(ws=>sweepProcessedCache(ctx,ws.id)))

async function loop(): Promise<void> {
  await ready
  await cacheReady
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
}

void Promise.all(Array.from({length:pipelineConfig.workerConcurrency},()=>loop())).then(async()=>{
  clearInterval(recoveryTimer);clearInterval(healthTimer)
  await releaseAll().catch(e=>console.error('[worker] release',e));close();process.exit(0)
})

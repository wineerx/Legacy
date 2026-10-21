import { diagnosticScope, recordDiagnostic } from '../diagnostics'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { complete, fail, deferJob, heartbeat, leaseNext, recoverExpired, type LeasedJob } from '../queue/queue'
import { extractFrame, makeThumbnail, renderVideoVersion } from '../media/ops'
import { getAsset, insertVersion, setAssetThumbnail } from '../repos/assets'
import { addNotification } from '../repos/notifications'
import { storedAssetDir } from '../services/library'
import { runTiktokExport, type ExportPayload } from '../services/export-tiktok'
import { fetchProfile, runReelDownload } from '../services/profile-download'
import { deliverWebhook, recordJobOutcome, WebhookRetryError } from '../services/webhooks'
import { notificationPreferences } from '../services/integrations'
import { publishInstagram, InstagramPending, InstagramApiError } from '../services/instagram-publishing'
import { pipelineConfig } from '../pipeline-config'
import { MediaToolError } from '../media/run'
import { deferPublicationAccount } from '../services/instagram-publication-limit'
import { PublicationQuotaWait } from '../services/instagram-quota'
import { ContainerHeld } from '../services/container-control'
import { holdContainerJob } from '../services/container-job-hold'

export type WorkerEvent = { type: 'job-updated'; workspaceId: string; jobId: string; state: 'running' | 'done' | 'retry' | 'failed' | 'cancelled' }
export const PERMANENT_CODES = new Set(['invalid_media', 'not_found', 'invalid_input', 'forbidden', 'duplicate'])

function requireAsset(ctx: Ctx, ws: string, assetId: string) {
  const a = getAsset(ctx.db, ws, assetId)
  if (!a) throw new AppError('not_found', 'O vídeo foi removido da biblioteca.')
  return a
}

export async function runJob(ctx: Ctx, job: LeasedJob): Promise<unknown> {
  const ws = job.workspaceId
  switch (job.type) {
    case 'publish_instagram': return publishInstagram(ctx, job)
    case 'webhook_delivery': return deliverWebhook(ctx, job)
    case 'fetch_profile': return fetchProfile(ctx, job)
    case 'download_reel': return runReelDownload(ctx, job)
    case 'make_thumbnail': {
      const { assetId } = job.payload as { assetId: string }
      const a = requireAsset(ctx, ws, assetId)
      const out = join(storedAssetDir(ctx, ws, assetId), 'thumb.jpg')
      await makeThumbnail(a.filePath, out, a.durationMs)
      await extractFrame(a.filePath, 0, join(storedAssetDir(ctx, ws, assetId), 'first-frame.png'), 360)
      setAssetThumbnail(ctx.db, ws, assetId, out)
      return { thumbnailPath: out }
    }
    case 'apply_banner': {
      const p = job.payload as { assetId: string; versionId: string; bannerPath?: string; startMs?: number; endMs?: number; coverPath?: string }
      const a = requireAsset(ctx, ws, p.assetId)
      const out = join(storedAssetDir(ctx, ws, p.assetId), 'versions', `banner-${p.versionId}.mp4`)
      const banner = p.bannerPath ? { png: p.bannerPath, window: { startMs: p.startMs ?? NaN, endMs: p.endMs ?? NaN } } : undefined
      await renderVideoVersion(a.filePath, out, { banner, coverPng: p.coverPath })
      insertVersion(ctx.db, {
        id: p.versionId, workspaceId: ws, assetId: p.assetId, kind: 'banner',
        paramsJson: JSON.stringify({ bannerPath: p.bannerPath ?? null, startMs: p.startMs ?? null, endMs: p.endMs ?? null, coverPath: p.coverPath ?? null }),
        filePath: out, createdAt: ctx.clock().toISOString()
      })
      return { filePath: out }
    }
    case 'export_tiktok':
      return runTiktokExport(ctx, ws, job.payload as ExportPayload)
    default:
      throw new AppError('invalid_input', `Tipo de tarefa desconhecido: ${job.type}`)
  }
}

export function maybeRecover(ctx: Ctx, lastRunMs: number, nowMs: number, intervalMs: number): number {
  if (nowMs - lastRunMs < intervalMs) return lastRunMs
  recoverExpired(ctx.db, new Date(nowMs))
  return nowMs
}

export async function processNext(ctx: Ctx, notify: (e: WorkerEvent) => void, leaseMs = pipelineConfig.leaseMs): Promise<boolean> {
  const job = leaseNext(ctx.db, ctx.clock(), leaseMs)
  if (!job) return false
  const base = { type: 'job-updated' as const, workspaceId: job.workspaceId, jobId: job.id }
  notify({ ...base, state: 'running' })
  const payloadIds = (job.payload ?? {}) as { assetId?: string; localAssetId?: string; accountId?: string; batchId?: string; profileId?: string; postId?: string }
  const scope = { traceId:job.id, batchId:payloadIds.batchId, mediaId: payloadIds.localAssetId ?? payloadIds.assetId ?? payloadIds.postId, accountId: payloadIds.accountId, metadata: { profileId: payloadIds.profileId, maxAttempts: job.maxAttempts }, workspaceId: job.workspaceId, taskId: job.id, attempt: job.attempts, source: 'worker', provider: job.type === 'publish_instagram' ? 'Instagram' : job.type === 'fetch_profile' ? 'Apify' : job.type === 'export_tiktok' ? 'TikTok' : 'Legacy' }
  recordDiagnostic({ ...scope, level: 'INFO', message: `Processando: ${job.label}` })
  const beat = setInterval(() => {
    try { heartbeat(ctx.db, job.id, ctx.clock(), leaseMs, job.leaseVersion) } catch (e) { recordDiagnostic({ ...scope, level: 'ERROR', message: 'Falha no heartbeat da tarefa', metadata: { stack: e instanceof Error ? e.stack : undefined } }); console.error('[worker] heartbeat', e) }
  }, leaseMs / 3)
  try {
    let result: unknown
    let failure: unknown
    let failed = false
    try {
      result = await diagnosticScope.run(scope, () => runJob(ctx, job))
    } catch (e) {
      failed = true
      failure = e
    }
    if (!failed) {
      try {
        const finished = ctx.db.transaction(() => {
          if (!complete(ctx.db, job, ctx.clock(), result)) return false
          recordJobOutcome(ctx, job, 'done')
          return true
        })
        if (finished) { notify({ ...base, state: 'done' }); recordDiagnostic({ ...scope, level: 'SUCCESS', message: `Confirmado: ${job.label}` }) }
      } catch (e) {
        recordDiagnostic({ ...scope, level: 'ERROR', message: 'Não foi possível persistir a conclusão da tarefa', metadata: { stack: e instanceof Error ? e.stack : undefined } })
        console.error('[worker] complete', e)
      }
    } else {
      if (failure instanceof ContainerHeld) {
        if (holdContainerJob(ctx,job,failure.control)) notify({ ...base, state: failure.control==='cancelled' ? 'cancelled' : 'retry' })
        return true
      }
      if (failure instanceof PublicationQuotaWait) {
        const resumeAt = deferPublicationAccount(ctx, job, undefined, { resumeAt: failure.resumeAt, checkedAt: failure.checkedAt })
        if (resumeAt) {
          notify({ ...base, state: 'retry' })
          recordDiagnostic({ ...scope, level: 'WARN', message: failure.message, metadata: { resumeAt, estimated: true, cause: 'quota_snapshot', checkedAt: failure.checkedAt, ...failure.reading } })
        }
        return true
      }
      if (failure instanceof InstagramApiError && failure.publicationLimited) {
        const resumeAt = deferPublicationAccount(ctx, job, failure.retryAfterMs)
        if (resumeAt) {
          notify({ ...base, state: 'retry' })
          recordDiagnostic({ ...scope, level: 'WARN', message: failure.message, metadata: { resumeAt, estimated: true, apiCode: failure.apiCode, apiSubcode: failure.apiSubcode } })
        }
        return true
      }
      if(failure instanceof InstagramPending) {
        if(deferJob(ctx.db,job,ctx.clock(),failure.retryAfterMs)) notify({...base,state:'retry'})
        return true
      }
      const code = failure instanceof AppError ? failure.code : 'internal'
      const message = failure instanceof Error ? failure.message : String(failure)
      const outcome = ctx.db.transaction(() => {
        const permanent=failure instanceof InstagramApiError ? !failure.retryable : failure instanceof MediaToolError ? !failure.retryable : PERMANENT_CODES.has(code) || (job.type==='publish_instagram' && code==='ffmpeg_failed')
        const outcome = fail(ctx.db, job, ctx.clock(), { code, message, permanent, retryAfterMs: failure instanceof WebhookRetryError || failure instanceof InstagramApiError ? failure.retryAfterMs : undefined })
        if (outcome === 'failed') recordJobOutcome(ctx, job, 'failed')
        return outcome
      })
      if (outcome !== 'stale') {
        recordDiagnostic({ ...scope, level: outcome === 'failed' ? 'ERROR' : 'WARN', message, metadata: { state: outcome, stack: failure instanceof Error ? failure.stack : undefined } })
        if (outcome === 'failed' && (job.type === 'webhook_delivery' || job.type === 'make_thumbnail') && notificationPreferences(ctx, job.workspaceId).failures) {
          addNotification(ctx.db, { workspaceId: job.workspaceId, kind: 'error', title: `Falhou: ${job.label}`, body: message, actionJson: JSON.stringify({ type: 'open_queue', jobId: job.id }) }, ctx.clock())
        }
        notify({ ...base, state: outcome })
      }
    }
  } finally {
    clearInterval(beat)
  }
  return true
}

/** Keep the lease and persisted running state while Meta prepares/acknowledges the container. */
export async function publicationUntilTerminal(run: () => Promise<unknown>, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), now = () => Date.now()): Promise<unknown> {
  const deadline = now() + 60 * 60_000
  for (;;) {
    try { return await run() } catch (error) {
      const pending = error instanceof InstagramPending
      const transient = !(error instanceof AppError) || error.code === 'internal'
      if (!pending && !transient) throw error
      if (now() >= deadline) throw new AppError('invalid_input', 'O Instagram não confirmou a publicação dentro de uma hora. Confira a conta antes de tentar novamente; o contêiner foi preservado.')
      recordDiagnostic({ level: 'WARN', source: 'worker', message: 'Aguardando confirmação do provider', metadata: { state: 'Waiting provider', reason: error instanceof Error ? error.message : 'Resposta pendente' } })
      await wait(pending ? error.retryAfterMs : 15_000)
    }
  }
}

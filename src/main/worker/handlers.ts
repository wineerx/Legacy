import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { complete, fail, heartbeat, leaseNext, recoverExpired, type LeasedJob } from '../queue/queue'
import { extractFrame, makeThumbnail, overlayBanner } from '../media/ops'
import { getAsset, insertVersion, setAssetThumbnail } from '../repos/assets'
import { addNotification } from '../repos/notifications'
import { storedAssetDir } from '../services/library'
import { runTiktokExport, type ExportPayload } from '../services/export-tiktok'
import { fetchProfile, runReelDownload } from '../services/profile-download'
import { deliverWebhook, recordJobOutcome, WebhookRetryError } from '../services/webhooks'
import { notificationPreferences } from '../services/integrations'
import { publishInstagram, InstagramPending } from '../services/instagram-publishing'

export type WorkerEvent = { type: 'job-updated'; workspaceId: string; jobId: string; state: 'running' | 'done' | 'retry' | 'failed' }
export const PERMANENT_CODES = new Set(['invalid_media', 'not_found', 'invalid_input', 'forbidden'])

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
      const p = job.payload as { assetId: string; bannerPath: string; startMs: number; endMs: number; versionId: string }
      const a = requireAsset(ctx, ws, p.assetId)
      const out = join(storedAssetDir(ctx, ws, p.assetId), 'versions', `banner-${p.versionId}.mp4`)
      await overlayBanner(a.filePath, p.bannerPath, out, { startMs: p.startMs, endMs: p.endMs })
      insertVersion(ctx.db, {
        id: p.versionId, workspaceId: ws, assetId: p.assetId, kind: 'banner',
        paramsJson: JSON.stringify({ bannerPath: p.bannerPath, startMs: p.startMs, endMs: p.endMs }),
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

export async function processNext(ctx: Ctx, notify: (e: WorkerEvent) => void, leaseMs = 60_000): Promise<boolean> {
  const job = leaseNext(ctx.db, ctx.clock(), leaseMs)
  if (!job) return false
  const base = { type: 'job-updated' as const, workspaceId: job.workspaceId, jobId: job.id }
  notify({ ...base, state: 'running' })
  const beat = setInterval(() => {
    try { heartbeat(ctx.db, job.id, ctx.clock(), leaseMs) } catch (e) { console.error('[worker] heartbeat', e) }
  }, leaseMs / 3)
  try {
    let result: unknown
    let failure: unknown
    let failed = false
    try {
      result = await runJob(ctx, job)
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
        if (finished) notify({ ...base, state: 'done' })
      } catch (e) {
        console.error('[worker] complete', e)
      }
    } else {
      const code = failure instanceof AppError ? failure.code : 'internal'
      const message = failure instanceof Error ? failure.message : String(failure)
      const outcome = ctx.db.transaction(() => {
        const outcome = fail(ctx.db, job, ctx.clock(), { code, message, permanent: PERMANENT_CODES.has(code), retryAfterMs: failure instanceof WebhookRetryError || failure instanceof InstagramPending ? failure.retryAfterMs : undefined })
        if (outcome === 'failed') recordJobOutcome(ctx, job, 'failed')
        return outcome
      })
      if (outcome !== 'stale') {
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

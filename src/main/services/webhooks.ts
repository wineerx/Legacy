import { createHmac, randomUUID } from 'node:crypto'
import { resolve4 } from 'node:dns/promises'
import { request } from 'node:https'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { enqueue, type LeasedJob } from '../queue/queue'
import { addNotification } from '../repos/notifications'
import { getSecret, notificationPreferences, webhookConfig, webhookUrl, type WebhookEvent } from './integrations'
import { publicIpv4 } from './download-http'

const payloadSchema = z.object({
  revision: z.string(), event: z.object({ id: z.uuid(), type: z.enum(['job.done', 'job.failed', 'webhook.test']), createdAt: z.iso.datetime(), workspaceId: z.uuid(),
    task: z.object({ id: z.string(), type: z.string(), state: z.enum(['done', 'failed']), attempt: z.number() }).optional() })
})
export class WebhookRetryError extends AppError { constructor(message: string, public retryAfterMs: number) { super('internal', message) } }

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

export function enqueueWebhook(ctx: Ctx, ws: string, type: WebhookEvent | 'webhook.test', job?: LeasedJob) {
  const config = webhookConfig(ctx, ws)
  if (!config.enabled || (type !== 'webhook.test' && !config.events.includes(type))) return null
  const event = { id: randomUUID(), type, createdAt: ctx.clock().toISOString(), workspaceId: ws,
    ...(job ? { task: { id: job.id, type: job.type, state: type === 'job.done' ? 'done' : 'failed', attempt: job.attempts } } : {}) }
  return enqueue(ctx.db, { workspaceId: ws, type: 'webhook_delivery', label: `Webhook: ${type}`, payload: { revision: config.revision, event }, maxAttempts: 5,
    idempotencyKey: job ? `webhook:${ws}:${job.attemptId}:${type}` : undefined }, ctx.clock())
}

// Called inside the same SQLite transaction that finalizes the source job.
export function recordJobOutcome(ctx: Ctx, job: LeasedJob, state: 'done' | 'failed'): void {
  if (job.type === 'webhook_delivery' || job.type === 'make_thumbnail') return
  const prefs = notificationPreferences(ctx, job.workspaceId)
  if ((state === 'done' && prefs.completed) || (state === 'failed' && prefs.failures)) {
    addNotification(ctx.db, { workspaceId: job.workspaceId, kind: state === 'done' ? 'info' : 'error', title: `${state === 'done' ? 'Concluída' : 'Falhou'}: ${job.label}`,
      body: state === 'done' ? 'A tarefa foi concluída. Consulte a fila para acompanhar o histórico.' : 'A tarefa precisa de atenção. Consulte o erro e as opções de retentativa na fila.',
      actionJson: JSON.stringify({ type: 'open_queue', jobId: job.id, groupId: (job.payload as { batchId?: string }).batchId ?? job.id, category: job.type === 'download_reel' || job.type === 'fetch_profile' ? 'download' : job.type === 'publish_instagram' ? 'publication' : 'system' }) }, ctx.clock())
  }
  enqueueWebhook(ctx, job.workspaceId, `job.${state}`, job)
}

export async function deliverWebhook(ctx: Ctx, job: LeasedJob): Promise<unknown> {
  const payload = payloadSchema.parse(job.payload)
  const config = webhookConfig(ctx, job.workspaceId)
  if (payload.event.workspaceId !== job.workspaceId) throw new AppError('forbidden', 'Evento de outro workspace.')
  if (!config.enabled || config.revision !== payload.revision || (payload.event.type !== 'webhook.test' && !config.events.includes(payload.event.type))) return { skipped: true, reason: 'Configuração desativada ou alterada.' }
  const secret = getSecret(ctx, job.workspaceId, 'webhookSecret')
  if (!secret) throw new AppError('invalid_input', 'Segredo do webhook indisponível. Salve a configuração novamente.')
  const url = webhookUrl(config.url)
  const body = JSON.stringify(payload.event)
  const timestamp = String(Math.floor(ctx.clock().getTime() / 1000))
  try {
    const signal = AbortSignal.timeout(15_000)
    const addresses = await resolve4(url.hostname)
    if (!addresses.length || addresses.some((ip) => !publicIpv4(ip))) throw new AppError('forbidden', 'O destino do webhook não resolve para uma rede pública.')
    signal.throwIfAborted()
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(url, { method: 'POST', signal, family: 4,
        lookup: (_host, _options, cb) => cb(null, addresses[0], 4),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Legacy-Event-Id': payload.event.id,
          'X-Legacy-Timestamp': timestamp, 'X-Legacy-Signature': signWebhook(secret, timestamp, body) }
      }, (res) => {
        const status = res.statusCode ?? 0
        const retry = res.headers['retry-after']
        res.destroy() // Never follow redirects or store remote response bodies.
        if (status >= 200 && status < 300) resolve(status)
        else if (status === 429 || status >= 500) {
          const raw = Number(retry)
          const delay = retry ? (Number.isFinite(raw) ? raw * 1000 : Date.parse(retry) - ctx.clock().getTime()) : 0
          reject(new WebhookRetryError(`Webhook respondeu HTTP ${status}. Nova tentativa será agendada.`, Number.isFinite(delay) ? Math.max(0, Math.min(delay, 24 * 3600_000)) : 0))
        } else reject(new AppError('invalid_input', `Webhook respondeu HTTP ${status}. Verifique o destino; redirecionamentos não são aceitos.`))
      })
      req.on('error', reject)
      req.end(body)
    })
    return { delivered: true, status, eventId: payload.event.id }
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('internal', 'Não foi possível entregar o webhook. Verifique a conexão e o destino.')
  }
}

import { beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve4 } from 'node:dns/promises'
import { request } from 'node:https'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { getSetting, setSetting } from '../repos/settings'
import { enqueue, leaseNext, listJobs } from '../queue/queue'
import { processNext } from '../worker/handlers'
import type { Ctx } from '../context'
import { deliverWebhook, enqueueWebhook, signWebhook, WebhookRetryError } from './webhooks'

vi.mock('node:dns/promises', () => ({ resolve4: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
let ctx: Ctx
let ws: string
const secret = 'a'.repeat(32)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolve4).mockResolvedValue(['8.8.8.8'])
  ctx = { db: memDb(), dataRoot: 'unused', clock: () => new Date('2026-10-05T12:00:00Z'), secret: () => secret }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  setSetting(ctx.db, ws, 'webhook', JSON.stringify({ enabled: true, url: 'https://example.com/hook', events: ['job.done', 'job.failed'], revision: 'r1' }))
})
function respond(statusCode: number, headers = {}) {
  let sent = ''
  vi.mocked(request).mockImplementationOnce(((_url: URL, _options: unknown, cb: Function) => {
    const req = new EventEmitter() as EventEmitter & { end(body: string): void }
    req.end = (body) => { sent = body; cb({ statusCode, headers, destroy: () => {} }) }
    return req
  }) as typeof request)
  return () => sent
}
it('entrega um evento assinado sem segredos e fixa DNS', async () => {
  enqueueWebhook(ctx, ws, 'webhook.test')
  const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
  const sent = respond(204)
  expect(await deliverWebhook(ctx, job)).toMatchObject({ delivered: true, status: 204 })
  const options = vi.mocked(request).mock.calls[0][1] as { headers: Record<string, string>; lookup: Function }
  expect(options.headers['X-Legacy-Signature']).toBe(signWebhook(secret, '1791201600', sent()))
  expect(sent()).not.toContain(secret)
  const cb = vi.fn(); options.lookup('ignored', {}, cb)
  expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4)
})
it('invalida envio antigo quando destino ou ativação muda', async () => {
  enqueueWebhook(ctx, ws, 'webhook.test')
  const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
  const config = JSON.parse(getSetting(ctx.db, ws, 'webhook')!)
  setSetting(ctx.db, ws, 'webhook', JSON.stringify({ ...config, revision: 'r2' }))
  expect(await deliverWebhook(ctx, job)).toMatchObject({ skipped: true })
  expect(request).not.toHaveBeenCalled()
})
it('respeita Retry-After e rejeita redirect e rede privada', async () => {
  enqueueWebhook(ctx, ws, 'webhook.test')
  const job = leaseNext(ctx.db, ctx.clock(), 60_000)!
  respond(429, { 'retry-after': '60' })
  await expect(deliverWebhook(ctx, job)).rejects.toMatchObject({ retryAfterMs: 60000 })
  respond(302)
  await expect(deliverWebhook(ctx, job)).rejects.toThrow(/redirecionamentos/)
  vi.mocked(resolve4).mockResolvedValue(['10.0.0.1'])
  await expect(deliverWebhook(ctx, job)).rejects.toThrow(/rede pública/)
  expect(request).toHaveBeenCalledTimes(2)
})
it('falha de tarefa grava outbox e entrega não produz recursão', async () => {
  enqueue(ctx.db, { workspaceId: ws, type: 'unknown' as never, payload: { token: 'private-token' }, label: 'Task' }, ctx.clock())
  await processNext(ctx, () => {})
  expect(listJobs(ctx.db, ws).filter((j) => j.type === 'webhook_delivery')).toHaveLength(1)
  const body = respond(200)
  await processNext(ctx, () => {})
  expect(body()).not.toContain('private-token')
  expect(listJobs(ctx.db, ws).filter((j) => j.type === 'webhook_delivery')).toHaveLength(1)
})

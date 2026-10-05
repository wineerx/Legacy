import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { getSetting } from '../repos/settings'
import type { Ctx } from '../context'
import { decryptSecret, getSecret, integrationStatus, saveSecret, saveWebhook, secretSnapshot, validateApify, webhookConfig } from './integrations'
import { apifyJson } from './download-http'

vi.mock('./download-http', async (original) => ({ ...await original<typeof import('./download-http')>(), apifyJson: vi.fn() }))
const vault = { available: () => true, encrypt: (v: string) => Buffer.from(v).toString('base64'), decrypt: (v: string) => Buffer.from(v, 'base64').toString() }
let ctx: Ctx
let ws: string
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('APIFY_TOKEN', '')
  ctx = { db: memDb(), dataRoot: 'unused', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  ctx.secret = (id, key) => decryptSecret(ctx, vault, id, key)
})
afterEach(() => vi.unstubAllEnvs())
it('salva protegido, não revela no status e isola credenciais', () => {
  const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  saveSecret(ctx, vault, ws, 'apifyToken', 'test-secret-value')
  expect(getSetting(ctx.db, ws, 'secret.apifyToken')).not.toContain('test-secret-value')
  expect(getSecret(ctx, ws, 'apifyToken')).toBe('test-secret-value')
  expect(getSecret(ctx, other, 'apifyToken')).toBeNull()
  expect(JSON.stringify(integrationStatus(ctx, ws, true))).not.toContain('test-secret-value')
  expect(secretSnapshot(ctx, vault)[ws].apifyToken).toBe('test-secret-value')
  saveSecret(ctx, vault, ws, 'apifyToken', '')
  expect(getSecret(ctx, ws, 'apifyToken')).toBeNull()
  expect(() => saveSecret(ctx, vault, 'missing', 'apifyToken', 'x')).toThrow(/Workspace/)
})
it('recusa criptografia indisponível e não faz fallback de chave ilegível', () => {
  expect(() => saveSecret(ctx, { ...vault, available: () => false }, ws, 'apifyToken', 'x')).toThrow(/indisponível/)
  saveSecret(ctx, vault, ws, 'apifyToken', 'secret')
  ctx.secret = () => null
  vi.stubEnv('APIFY_TOKEN', 'different-account')
  expect(getSecret(ctx, ws, 'apifyToken')).toBeNull()
})
it('testa token sem criar execução paga e registra a data', async () => {
  saveSecret(ctx, vault, ws, 'apifyToken', 'test-token')
  vi.mocked(apifyJson).mockResolvedValue({ data: { id: 'account' } })
  expect(await validateApify(ctx, ws)).toEqual({ validatedAt: '2026-10-05T12:00:00.000Z' })
  expect(apifyJson).toHaveBeenCalledWith('users/me', 'test-token')
})
it('webhook começa desativado e trocar destino invalida entregas anteriores', () => {
  expect(webhookConfig(ctx, ws).enabled).toBe(false)
  expect(() => saveWebhook(ctx, vault, ws, { enabled: true, url: '', events: ['job.done'] })).toThrow(/destino/)
  saveWebhook(ctx, vault, ws, { enabled: true, url: 'https://example.com/hook', events: ['job.done'], secret: 'a'.repeat(32) })
  const first = webhookConfig(ctx, ws).revision
  saveWebhook(ctx, vault, ws, { enabled: true, url: 'https://example.com/other', events: ['job.done'] })
  expect(webhookConfig(ctx, ws).revision).not.toBe(first)
  expect(() => saveWebhook(ctx, vault, ws, { enabled: true, url: 'http://localhost/hook', events: ['job.done'] })).toThrow(/HTTPS/)
})

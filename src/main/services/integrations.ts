import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { getSetting, setSetting } from '../repos/settings'
import { listWorkspaces } from '../repos/workspaces'
import { apifyJson } from './download-http'

export type SecretKey = 'apifyToken' | 'webhookSecret' | 'instagramToken'
export type SecretMap = Record<string, Partial<Record<SecretKey, string>>>
export interface SecretVault { available(): boolean; encrypt(value: string): string; decrypt(value: string): string }
export type WebhookEvent = 'job.done' | 'job.failed'
export interface WebhookConfig { enabled: boolean; url: string; events: WebhookEvent[]; revision: string }
export interface NotificationPreferences { desktop: boolean; completed: boolean; failures: boolean }

export function requireWorkspace(ctx: Ctx, ws: string): void {
  if (!listWorkspaces(ctx.db).some((w) => w.id === ws)) throw new AppError('not_found', 'Workspace não encontrado.')
}
export function getSecret(ctx: Ctx, ws: string, key: SecretKey): string | null {
  const saved = ctx.secret?.(ws, key)
  // An unreadable stored token must not silently fall back to another account.
  if (saved) return saved
  if (getSetting(ctx.db, ws, `secret.${key}`)) return null
  return key === 'apifyToken' ? process.env.APIFY_TOKEN?.trim() || null : null
}
export function decryptSecret(ctx: Ctx, vault: SecretVault, ws: string, key: SecretKey): string | null {
  const value = getSetting(ctx.db, ws, `secret.${key}`)
  if (!value) return null
  try { return vault.decrypt(value) } catch { return null }
}
export function secretSnapshot(ctx: Ctx, vault: SecretVault): SecretMap {
  return Object.fromEntries(listWorkspaces(ctx.db).map((w) => [w.id, {
    apifyToken: decryptSecret(ctx, vault, w.id, 'apifyToken') ?? undefined,
    webhookSecret: decryptSecret(ctx, vault, w.id, 'webhookSecret') ?? undefined,
    instagramToken: decryptSecret(ctx, vault, w.id, 'instagramToken') ?? undefined
  }]))
}
export function saveSecret(ctx: Ctx, vault: SecretVault, ws: string, key: SecretKey, value: string): void {
  requireWorkspace(ctx, ws)
  if (value && !vault.available()) throw new AppError('forbidden', 'A proteção de credenciais do sistema está indisponível.')
  try { setSetting(ctx.db, ws, `secret.${key}`, value ? vault.encrypt(value) : '') }
  catch { throw new AppError('internal', 'Não foi possível proteger e salvar a credencial.') }
}
export function notificationPreferences(ctx: Ctx, ws: string): NotificationPreferences {
  const value = getSetting(ctx.db, ws, 'notificationPreferences')
  return value ? JSON.parse(value) : { desktop: true, completed: true, failures: true }
}
export function webhookConfig(ctx: Ctx, ws: string): WebhookConfig {
  const value = getSetting(ctx.db, ws, 'webhook')
  return value ? JSON.parse(value) : { enabled: false, url: '', events: ['job.done', 'job.failed'], revision: '' }
}
export function webhookUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new AppError('invalid_input', 'Informe uma URL HTTPS pública para o webhook.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search || isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.localhost')) {
    throw new AppError('invalid_input', 'Use um domínio HTTPS público na porta padrão, sem credenciais, parâmetros ou fragmentos.')
  }
  return url
}
export function saveWebhook(ctx: Ctx, vault: SecretVault, ws: string, input: { enabled: boolean; url: string; events: WebhookEvent[]; secret?: string }) {
  requireWorkspace(ctx, ws)
  const url = input.url ? webhookUrl(input.url).href : ''
  if (input.enabled && (!url || (!input.secret && !getSecret(ctx, ws, 'webhookSecret')))) throw new AppError('invalid_input', 'Informe o destino e o segredo de assinatura antes de ativar.')
  ctx.db.transaction(() => {
    if (input.secret) saveSecret(ctx, vault, ws, 'webhookSecret', input.secret)
    const before = webhookConfig(ctx, ws)
    // A changed destination/key invalidates pending deliveries to prevent rerouting old data.
    const revision = before.url === url && !input.secret && before.enabled === input.enabled ? before.revision : randomUUID()
    setSetting(ctx.db, ws, 'webhook', JSON.stringify({ enabled: input.enabled, url, events: input.events, revision }))
  })
}
export function integrationStatus(ctx: Ctx, ws: string, vaultAvailable: boolean) {
  requireWorkspace(ctx, ws)
  const stored = Boolean(getSetting(ctx.db, ws, 'secret.apifyToken'))
  return {
    apify: { configured: Boolean(getSecret(ctx, ws, 'apifyToken')), source: stored ? 'saved' as const : process.env.APIFY_TOKEN?.trim() ? 'environment' as const : 'none' as const, lastValidatedAt: getSetting(ctx.db, ws, 'apifyValidatedAt') },
    secureStorage: vaultAvailable,
    webhook: { ...webhookConfig(ctx, ws), hasSecret: Boolean(getSecret(ctx, ws, 'webhookSecret')) },
    notifications: notificationPreferences(ctx, ws)
  }
}
export async function validateApify(ctx: Ctx, ws: string): Promise<{ validatedAt: string }> {
  requireWorkspace(ctx, ws)
  const token = getSecret(ctx, ws, 'apifyToken')
  if (!token) throw new AppError('invalid_input', 'Cadastre a chave Apify antes de testar.')
  const data = await apifyJson('users/me', token) as { data?: { id?: string } }
  if (!data?.data?.id) throw new AppError('internal', 'A Apify retornou uma resposta inesperada.')
  // Avoid attributing a slow check of the old token to a newly saved credential.
  if (getSecret(ctx, ws, 'apifyToken') !== token) throw new AppError('invalid_input', 'A credencial mudou durante o teste. Teste novamente.')
  const validatedAt = ctx.clock().toISOString()
  setSetting(ctx.db, ws, 'apifyValidatedAt', validatedAt)
  return { validatedAt }
}

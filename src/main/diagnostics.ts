import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import type { RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { sanitize, type DiagnosticEvent } from '@shared/diagnostics'

export const diagnosticScope = new AsyncLocalStorage<Partial<DiagnosticEvent>>()
const events: DiagnosticEvent[] = []
const responses = new WeakMap<object, unknown>()
export const diagnosticResponse = (req: object, value: unknown) =>
  responses.set(req, sanitize(value))
const knownSecrets = new Set<string>()
export function rememberDiagnosticSecret(value: string | null | undefined) {
  if (value && value.length >= 8) knownSecrets.add(value)
  return value
}
function scrubKnown(value: unknown): unknown {
  if (typeof value === 'string') {
    for (const secret of knownSecrets)
      value = (value as string).split(secret).join('[REDACTED]')
    return value
  }
  if (Array.isArray(value)) return value.map(scrubKnown)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubKnown(v)]),
    )
  return value
}
export const sanitizeDiagnostic = <T>(value: T): T =>
  sanitize(scrubKnown(value)) as T
let sink: ((event: DiagnosticEvent) => void) | undefined
let heartbeat: string | null = null
export const setDiagnosticSink = (value: typeof sink) => {
  sink = value
}
export const setWorkerHeartbeat = (timestamp: string | null) => {
  heartbeat = timestamp
}
export const workerHeartbeat = () => heartbeat
export function recordDiagnostic(
  input: Partial<DiagnosticEvent> &
    Pick<DiagnosticEvent, 'level' | 'source' | 'message'>,
) {
  const event = sanitize(
    scrubKnown({
      ...diagnosticScope.getStore(),
      ...input,
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
    }),
  ) as DiagnosticEvent
  events.push(event)
  if (events.length > 2000) events.splice(0, events.length - 2000)
  sink?.(event)
  return event
}
export const diagnosticEvents = (workspaceId: string) =>
  events
    .filter(
      (e) =>
        e.workspaceId === workspaceId ||
        (!e.workspaceId && e.source === 'processor'),
    )
    .map((e) => sanitize(scrubKnown(e)) as DiagnosticEvent)

/** Observe transport without retaining request bodies, credentials or arbitrary response bodies. */
export function diagnosticRequest(
  url: string | URL,
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) {
  const target = new URL(url)
  const provider = target.hostname.includes('instagram')
    ? 'Instagram'
    : target.hostname.includes('apify')
      ? 'Apify'
      : target.hostname.includes('tiktok')
        ? 'TikTok'
        : 'Legacy'
  const start = Date.now(),
    requestId = randomUUID()
  let recorded = false
  const finish = (
    statusCode?: number,
    failure?: string,
    response?: unknown,
  ) => {
    if (recorded) return
    recorded = true
    const duration = Date.now() - start
    recordDiagnostic({
      level:
        failure || (statusCode ?? 0) >= 400
          ? 'ERROR'
          : duration > 3000
            ? 'WARN'
            : 'INFO',
      source: 'network',
      provider,
      endpoint:
        target.hostname.endsWith('instagram.com') ||
        target.hostname === 'api.apify.com'
          ? target.pathname
          : '/[caminho externo]',
      method: options.method ?? 'GET',
      requestId,
      statusCode,
      duration,
      message: failure ?? `${provider} · HTTP ${statusCode}`,
      metadata:
        response || responses.get(req)
          ? { response: response ?? responses.get(req) }
          : undefined,
    })
  }
  const req = httpsRequest(url, options, (res) => {
    // Never attach a data listener: that would put downloads into flowing mode.
    if (typeof res.once !== 'function')
      finish(res.statusCode)
    else {
      res.once('end', () => queueMicrotask(() => finish(res.statusCode)))
      res.once('error', () => finish(res.statusCode, 'Resposta interrompida'))
      res.once('aborted', () => finish(res.statusCode, 'Resposta interrompida'))
      res.once('close', () =>
        finish(
          res.statusCode,
          res.complete === false && (res.statusCode ?? 0) < 300 ? 'Resposta interrompida' : undefined,
        ),
      )
    }
    callback(res)
  })
  req.once('error', () =>
    finish(undefined, 'Conexão perdida ou timeout; confirmação pendente'),
  )
  return req
}

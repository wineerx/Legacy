export type LogLevel = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' | 'FATAL'
export interface DiagnosticEvent {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  workspaceId?: string
  taskId?: string
  traceId?: string
  batchId?: string
  mediaId?: string
  accountId?: string
  provider?: string
  requestId?: string
  statusCode?: number
  duration?: number
  attempt?: number
  endpoint?: string
  method?: string
  metadata?: unknown
}
const secretKey =
  /token|cookie|authorization|password|passwd|secret|credential|api.?key|signature/i
/** Sanitize before crossing IPC, including nested JSON, URLs and free-text errors. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[limite]'
  if (typeof value === 'string')
    return value
      .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [REDACTED]')
      .replace(
        /((?:[\w.-]*(?:token|cookie|authorization|password|passwd|secret|credential|api[_-]?key|signature)[\w.-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;}]+)/gi,
        '$1[REDACTED]',
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .slice(0, 12000)
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([k, v]) => [
          k,
          secretKey.test(k) ? '[REDACTED]' : sanitize(v, depth + 1),
        ]),
    )
  return value
}
export function groupEvents(events: DiagnosticEvent[]) {
  const groups: { event: DiagnosticEvent; occurrences: DiagnosticEvent[] }[] =
    []
  for (const event of events) {
    const previous = groups.at(-1)
    const key = (e: DiagnosticEvent) =>
      JSON.stringify([
        e.level,
        e.source,
        e.message,
        e.provider,
        e.endpoint,
        e.method,
        e.statusCode,
      ])
    if (previous && key(previous.event) === key(event))
      previous.occurrences.push(event)
    else groups.push({ event, occurrences: [event] })
  }
  return groups
}

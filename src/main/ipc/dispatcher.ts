import { diagnosticScope, recordDiagnostic, rememberDiagnosticSecret } from '../diagnostics'
import { contract, type Channel, type Input, type Outputs, type IpcResult } from '@shared/ipc-contract'
import { toErrorPayload } from '@shared/errors'

export type Handlers = { [C in Channel]: (input: Input<C>) => Promise<Outputs[C]> | Outputs[C] }

export function createDispatcher(handlers: Handlers) {
  return async (channel: string, raw: unknown): Promise<IpcResult<unknown>> => {
    if (!Object.hasOwn(contract, channel)) return { ok: false, error: { code: 'invalid_input', message: `Canal desconhecido: ${channel}` } }
    const c = channel as Channel
    const parsed = contract[c].safeParse(raw ?? {})
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { ok: false, error: { code: 'invalid_input', message: `Entrada inválida em ${issue?.path.join('.') || 'raiz'}: ${issue?.message}` } }
    }
    for (const [key, value] of Object.entries(parsed.data)) { if (/token|secret|password|cookie|authorization/i.test(key) && typeof value === 'string') rememberDiagnosticSecret(value) }
    const ids = parsed.data as { workspaceId?: string; id?: string; assetId?: string; accountId?: string; profileId?: string }
    const scope = { workspaceId: ids.workspaceId, taskId: channel.startsWith('jobs.') ? ids.id : undefined, mediaId: ids.assetId, accountId: ids.accountId, metadata: { profileId: ids.profileId } }
    const start = Date.now()
    try {
      const fn = handlers[c] as (i: unknown) => unknown
      const data = await diagnosticScope.run(scope, () => fn(parsed.data))
      if (channel !== 'diagnostics.snapshot' && scope.workspaceId) recordDiagnostic({ ...scope, source: 'ipc', provider: 'Legacy', endpoint: channel, method: 'IPC', level: 'DEBUG', duration: Date.now() - start, message: channel })
      return { ok: true, data }
    } catch (e) {
      recordDiagnostic({ ...scope, duration: Date.now() - start, level: 'ERROR', source: 'ipc', provider: 'Legacy', endpoint: channel, method: 'IPC', message: toErrorPayload(e).message, metadata: { stack: e instanceof Error ? e.stack : undefined } })
      if (e instanceof Error && e.name === 'PathEscapeError') return { ok: false, error: { code: 'invalid_input', message: 'Caminho fora da pasta permitida.' } }
      if (!(e instanceof Error && e.name === 'AppError')) console.error(`[ipc] ${channel}`, e)
      return { ok: false, error: toErrorPayload(e) }
    }
  }
}

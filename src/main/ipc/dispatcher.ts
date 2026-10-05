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
    try {
      const fn = handlers[c] as (i: unknown) => unknown
      return { ok: true, data: await fn(parsed.data) }
    } catch (e) {
      if (e instanceof Error && e.name === 'PathEscapeError') return { ok: false, error: { code: 'invalid_input', message: 'Caminho fora da pasta permitida.' } }
      if (!(e instanceof Error && e.name === 'AppError')) console.error(`[ipc] ${channel}`, e)
      return { ok: false, error: toErrorPayload(e) }
    }
  }
}

import type { Channel, Input, Outputs, IpcResult } from '@shared/ipc-contract'
import type { AppErrorCode } from '@shared/errors'
import type {} from '../../preload/api'
import { beginActivity } from '../components/brand/activity'

export class ApiError extends Error {
  constructor(public readonly code: AppErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function call<C extends Channel>(channel: C, input: Input<C>): Promise<Outputs[C]> {
  const end = beginActivity(channel, (input as { workspaceId?: string }).workspaceId)
  try {
    const r = (await window.legacy.invoke(channel, input)) as IpcResult<Outputs[C]>
    if (!r.ok) throw new ApiError(r.error.code, r.error.message)
    if (r.data === null || (Array.isArray(r.data) && r.data.length === 0)) end('cancelled')
    else if (channel === 'library.pickAndImport' || channel === 'library.importPaths') {
      const results = r.data as Outputs['library.importPaths']
      const rejected = results.filter(item => item.status === 'rejected').length
      const imported = results.filter(item => item.status === 'imported').length
      end(rejected ? 'warning' : imported ? 'finished' : 'cancelled', rejected ? `${rejected} arquivo(s) não foram importados. Confira o resultado da importação.` : `${imported} vídeo(s) importado(s).`)
    } else end('finished', channel === 'profiles.scheduleInstagram' ? 'Agendamento salvo. A publicação aguarda o horário escolhido.' : 'Operação concluída no Legacy.')
    return r.data
  } catch (error) {
    end('error', error instanceof Error ? error.message : 'Não foi possível concluir a operação.')
    throw error
  }
}

export function onEvent(name: 'jobs.changed' | 'app.navigate', cb: (payload: unknown) => void): () => void {
  return window.legacy.on(name, cb)
}

export const mediaUrl = (path: string): string => `legacy-media://file/${encodeURIComponent(path)}`
export const pathForFile = (file: File): string => window.legacy.pathForFile(file)

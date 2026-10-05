import type { Channel, Input, Outputs, IpcResult } from '@shared/ipc-contract'
import type { AppErrorCode } from '@shared/errors'
import type {} from '../../preload/api'

export class ApiError extends Error {
  constructor(public readonly code: AppErrorCode, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function call<C extends Channel>(channel: C, input: Input<C>): Promise<Outputs[C]> {
  const r = (await window.legacy.invoke(channel, input)) as IpcResult<Outputs[C]>
  if (!r.ok) throw new ApiError(r.error.code, r.error.message)
  return r.data
}

export function onEvent(name: 'jobs.changed' | 'app.navigate', cb: (payload: unknown) => void): () => void {
  return window.legacy.on(name, cb)
}

export const mediaUrl = (path: string): string => `legacy-media://file/${encodeURIComponent(path)}`
export const pathForFile = (file: File): string => window.legacy.pathForFile(file)

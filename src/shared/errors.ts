export type AppErrorCode =
  | 'invalid_url' | 'invalid_input' | 'not_found' | 'invalid_media'
  | 'duplicate' | 'ffmpeg_failed' | 'forbidden' | 'internal'

export class AppError extends Error {
  constructor(public readonly code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
  }
}

export function toErrorPayload(e: unknown): { code: AppErrorCode; message: string } {
  if (e instanceof AppError) return { code: e.code, message: e.message }
  return { code: 'internal', message: 'Algo deu errado. Veja os detalhes no log.' }
}

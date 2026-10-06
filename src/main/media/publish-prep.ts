import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'

export type PreparedCopy = { path: string; cleanup(): void }

// Remux only: the Reels spec asks for moov first and no edit lists; no re-encode, original untouched.
export async function preparePublishCopy(input: string, tmpDir: string): Promise<PreparedCopy> {
  mkdirSync(tmpDir, { recursive: true })
  const path = join(tmpDir, `${randomUUID()}.mp4`)
  try {
    await runTool(ffmpegPaths().ffmpeg, ['-y', '-hide_banner', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-map_metadata', '-1', '-use_editlist', '0', '-movflags', '+faststart', path], { timeoutMs: 300_000 })
  } catch {
    // A file ffmpeg cannot remux will not succeed on retry: fail permanently with guidance.
    rmSync(path, { force: true })
    throw new AppError('invalid_media', 'Não foi possível preparar o vídeo para publicação. Confira se o arquivo é um MP4 válido.')
  }
  return { path, cleanup: () => rmSync(path, { force: true }) }
}

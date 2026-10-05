import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AppError } from '@shared/errors'

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    process.env.LEGACY_FFMPEG_DIR,
    resourcesPath ? join(resourcesPath, 'bin') : undefined,
    resolve('resources', 'bin', 'win32-x64')
  ].filter((d): d is string => Boolean(d))
  for (const dir of candidates) {
    const ffmpeg = join(dir, 'ffmpeg.exe')
    const ffprobe = join(dir, 'ffprobe.exe')
    if (existsSync(ffmpeg) && existsSync(ffprobe)) return { ffmpeg, ffprobe }
  }
  throw new AppError('internal', 'FFmpeg não encontrado. Rode npm run fetch:ffmpeg.')
}

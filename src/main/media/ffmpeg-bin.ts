import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AppError } from '@shared/errors'

function binDirs(override?: string): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return [override, resourcesPath ? join(resourcesPath, 'bin') : undefined, resolve('resources', 'bin', 'win32-x64')].filter((d): d is string => Boolean(d))
}

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  for (const dir of binDirs(process.env.LEGACY_FFMPEG_DIR)) {
    const ffmpeg = join(dir, 'ffmpeg.exe')
    const ffprobe = join(dir, 'ffprobe.exe')
    if (existsSync(ffmpeg) && existsSync(ffprobe)) return { ffmpeg, ffprobe }
  }
  throw new AppError('internal', 'FFmpeg não encontrado. Rode npm run fetch:ffmpeg.')
}

export function cloudflaredPath(): string {
  for (const dir of binDirs(process.env.LEGACY_CLOUDFLARED_DIR)) {
    const bin = join(dir, 'cloudflared.exe')
    if (existsSync(bin)) return bin
  }
  throw new AppError('invalid_input', 'Componente de publicação ausente. Reinstale o Legacy ou rode npm run fetch:cloudflared.')
}

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { AppError } from '@shared/errors'
import { audioTrackExtension } from '@shared/container-visual'
import type { Ctx } from '../context'
import { probeAudio } from '../media/probe'
import { workspaceDir, resolveInside } from '../paths'
import { requireWorkspace } from './integrations'

import type { AudioTrackDto } from '@shared/ipc-contract'

export type AudioTrackExtension = AudioTrackDto['ext']

const MAX_AUDIO_BYTES = 200 * 1024 * 1024
const audioDir = (ctx: Pick<Ctx, 'dataRoot'>, ws: string) => resolveInside(workspaceDir(ctx.dataRoot, ws), 'audio')

export function audioTrackPath(ctx: Pick<Ctx, 'dataRoot'>, ws: string, sha256: string, ext: AudioTrackExtension): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AppError('invalid_input', 'Faixa de áudio inválida.')
  return resolveInside(audioDir(ctx, ws), `${sha256}.${audioTrackExtension.parse(ext)}`)
}

export async function audioFileHash(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Copies the track into the workspace; the chosen file is never changed. Re-importing the same bytes returns the same track. */
export async function importAudioTrack(ctx: Ctx, ws: string, path: string): Promise<AudioTrackDto> {
  requireWorkspace(ctx, ws)
  const ext = audioTrackExtension.safeParse(extname(path).slice(1).toLowerCase())
  if (!ext.success) throw new AppError('invalid_input', 'Use um áudio MP3, M4A, AAC ou WAV.')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) throw new AppError('not_found', 'Arquivo de áudio não encontrado.')
  if (info.size > MAX_AUDIO_BYTES) throw new AppError('invalid_input', 'Áudio acima de 200 MB.')
  const { durationMs } = await probeAudio(path)
  if (durationMs <= 0) throw new AppError('invalid_media', 'Não foi possível ler a duração do áudio.')
  const sha256 = await audioFileHash(path)
  const target = audioTrackPath(ctx, ws, sha256, ext.data)
  await mkdir(audioDir(ctx, ws), { recursive: true })
  const existing = await readMeta(`${target}.json`)
  if (existing && await stat(target).then(s => s.isFile(), () => false)) return existing
  const partial = `${target}.${randomUUID()}.partial`
  try {
    await copyFile(path, partial)
    if (await audioFileHash(partial) !== sha256) throw new AppError('invalid_media', 'O áudio mudou durante a cópia. Tente de novo.')
    await rename(partial, target)
  } finally { await rm(partial, { force: true }) }
  const dto: AudioTrackDto = { sha256, ext: ext.data, name: basename(path).slice(0, 200), durationMs, sizeBytes: info.size, importedAt: ctx.clock().toISOString() }
  await writeFile(`${target}.json`, JSON.stringify(dto))
  return dto
}

async function readMeta(file: string): Promise<AudioTrackDto | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as AudioTrackDto } catch { return null }
}

export async function listAudioTracks(ctx: Ctx, ws: string): Promise<AudioTrackDto[]> {
  requireWorkspace(ctx, ws)
  const names = await readdir(audioDir(ctx, ws)).catch(() => [] as string[])
  const tracks = await Promise.all(names.filter(n => n.endsWith('.json')).map(n => readMeta(resolveInside(audioDir(ctx, ws), n))))
  return tracks.filter((t): t is AudioTrackDto => Boolean(t)).sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

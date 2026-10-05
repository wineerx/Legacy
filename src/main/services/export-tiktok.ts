import { eq } from 'drizzle-orm'
import { jobs } from '../db/schema'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { workspaceDir, resolveInside } from '../paths'
import { enqueue } from '../queue/queue'
import { getAsset, latestVersion } from '../repos/assets'
import { addNotification } from '../repos/notifications'
import { stripMetadata } from '../media/ops'
import type { Validation } from '../media/validate'

export interface ExportPayload { assetIds: string[]; captions: Record<string, string>; stripMetadata: boolean; remindAt: (string | null)[] }

export function requestTiktokExport(ctx: Ctx, ws: string, payload: ExportPayload): JobView {
  if (payload.assetIds.length === 0) throw new AppError('invalid_input', 'Selecione ao menos um vídeo.')
  if (payload.remindAt.length !== payload.assetIds.length) throw new AppError('invalid_input', 'Lembretes e vídeos não conferem.')
  for (const id of payload.assetIds) {
    const a = getAsset(ctx.db, ws, id)
    if (!a) throw new AppError('not_found', 'Vídeo não encontrado.')
    const v = JSON.parse(a.validationJson) as Validation
    if (!v.ok) throw new AppError('invalid_media', `${a.sourceName} não pode ser exportado: ${v.errors.join(' ')}`)
  }
  const remindAt = payload.remindAt.map((x) => {
    if (x === null) return null
    const d = new Date(x)
    if (Number.isNaN(d.getTime())) throw new AppError('invalid_input', 'Horário de lembrete inválido.')
    return d.toISOString()
  })
  const normalized: ExportPayload = { ...payload, remindAt }
  const versions = payload.assetIds.map((id) => [latestVersion(ctx.db, ws, id, 'cover_png')?.id ?? null, latestVersion(ctx.db, ws, id, 'banner')?.id ?? null])
  const key = createHash('sha256').update(JSON.stringify({ payload: normalized, versions })).digest('hex').slice(0, 32)
  const now = ctx.clock()
  const baseKey = `export:${ws}:${key}`
  const existing = ctx.db.select({ state: jobs.state }).from(jobs).where(eq(jobs.idempotencyKey, baseKey)).get()
  const finished = existing && (existing.state === 'done' || existing.state === 'failed' || existing.state === 'cancelled')
  return enqueue(ctx.db, {
    workspaceId: ws, type: 'export_tiktok', payload: normalized,
    label: `Exportar ${payload.assetIds.length} vídeo(s) para TikTok`, idempotencyKey: finished ? `${baseKey}:${now.getTime()}` : baseKey
  }, now)
}

export async function runTiktokExport(ctx: Ctx, ws: string, payload: ExportPayload): Promise<{ folders: string[] }> {
  const now = ctx.clock()
  const day = now.toISOString().slice(0, 10)
  const root = resolveInside(workspaceDir(ctx.dataRoot, ws), 'exports', 'tiktok')
  const folders: string[] = []
  const reminders: Parameters<typeof addNotification>[1][] = []
  for (const [i, id] of payload.assetIds.entries()) {
    const asset = getAsset(ctx.db, ws, id)
    if (!asset) throw new AppError('not_found', 'Vídeo não encontrado.')
    const folder = join(root, `${day}-${String(i + 1).padStart(2, '0')}-${id.slice(0, 8)}`)
    await mkdir(folder, { recursive: true })
    const source = latestVersion(ctx.db, ws, id, 'banner')?.filePath ?? asset.filePath
    const videoOut = join(folder, 'video.mp4')
    if (payload.stripMetadata) await stripMetadata(source, videoOut)
    else await copyFile(source, videoOut)
    const cover = latestVersion(ctx.db, ws, id, 'cover_png')
    if (cover) await copyFile(cover.filePath, join(folder, 'capa.png'))
    const caption = payload.captions[id] ?? ''
    await writeFile(join(folder, 'legenda.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(caption, 'utf8')]))
    const due = payload.remindAt[i]
    if (due) {
      reminders.push({
        workspaceId: ws, kind: 'manual_task', title: 'Postar no TikTok',
        body: `${asset.sourceName} está pronto para postar manualmente.`,
        actionJson: JSON.stringify({ type: 'open_folder', path: folder }), dueAt: due
      })
    }
    folders.push(folder)
  }
  for (const r of reminders) addNotification(ctx.db, r, now)
  return { folders }
}

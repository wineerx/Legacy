import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { enqueue } from '../queue/queue'
import { getAsset, insertVersion, listVersions, type AssetVersion } from '../repos/assets'
import { storedAssetDir } from './library'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function assertPng(bytes: Uint8Array): void {
  if (bytes.length > 20 * 1024 * 1024) throw new AppError('invalid_input', 'Imagem acima de 20 MB.')
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new AppError('invalid_input', 'A imagem precisa ser PNG.')
}

async function versionsDir(ctx: Ctx, ws: string, assetId: string): Promise<string> {
  if (!getAsset(ctx.db, ws, assetId)) throw new AppError('not_found', 'Vídeo não encontrado.')
  const dir = join(storedAssetDir(ctx, ws, assetId), 'versions')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function saveRenderedCover(ctx: Ctx, ws: string, assetId: string, templateId: string, png: Uint8Array): Promise<AssetVersion> {
  assertPng(png)
  const dir = await versionsDir(ctx, ws, assetId)
  const id = newId()
  const filePath = join(dir, `cover-${id}.png`)
  await writeFile(filePath, png)
  return insertVersion(ctx.db, { id, workspaceId: ws, assetId, kind: 'cover_png', paramsJson: JSON.stringify({ templateId }), filePath, createdAt: ctx.clock().toISOString() })
}

export type VideoVersionRequest = { banner?: { png: Uint8Array; startMs: number; endMs: number }; coverVersionId?: string }

/** Enfileira a versão editada (banner e/ou capa como primeiro frame). O id da versão sai antes do job terminar. */
export async function requestVideoVersion(ctx: Ctx, ws: string, assetId: string, req: VideoVersionRequest): Promise<{ versionId: string; job: JobView }> {
  if (!req.banner && !req.coverVersionId) throw new AppError('invalid_input', 'Escolha uma capa ou um banner.')
  if (req.banner && (req.banner.startMs < 0 || req.banner.endMs <= req.banner.startMs)) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
  if (req.banner) assertPng(req.banner.png)
  const dir = await versionsDir(ctx, ws, assetId)
  let coverPath: string | undefined
  if (req.coverVersionId) {
    const cover = listVersions(ctx.db, ws, assetId).find((v) => v.id === req.coverVersionId && v.kind === 'cover_png')
    if (!cover) throw new AppError('not_found', 'Capa não encontrada para este vídeo.')
    coverPath = cover.filePath
  }
  const versionId = newId()
  let bannerPath: string | undefined
  if (req.banner) {
    bannerPath = join(dir, `banner-${versionId}.png`)
    await writeFile(bannerPath, req.banner.png)
  }
  const job = enqueue(ctx.db, {
    workspaceId: ws, type: 'apply_banner', label: coverPath ? 'Inserir capa no vídeo' : 'Aplicar banner no vídeo',
    payload: { assetId, versionId, bannerPath, startMs: req.banner?.startMs, endMs: req.banner?.endMs, coverPath },
    idempotencyKey: `banner:${versionId}`
  }, ctx.clock())
  return { versionId, job }
}

export async function requestBanner(ctx: Ctx, ws: string, assetId: string, png: Uint8Array, window: { startMs: number; endMs: number }): Promise<JobView> {
  return (await requestVideoVersion(ctx, ws, assetId, { banner: { png, ...window } })).job
}

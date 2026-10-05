import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { enqueue } from '../queue/queue'
import { getAsset, insertVersion, type AssetVersion } from '../repos/assets'
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

export async function requestBanner(ctx: Ctx, ws: string, assetId: string, png: Uint8Array, window: { startMs: number; endMs: number }): Promise<JobView> {
  if (window.startMs < 0 || window.endMs <= window.startMs) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
  assertPng(png)
  const dir = await versionsDir(ctx, ws, assetId)
  const versionId = newId()
  const bannerPath = join(dir, `banner-${versionId}.png`)
  await writeFile(bannerPath, png)
  return enqueue(ctx.db, {
    workspaceId: ws, type: 'apply_banner', label: 'Aplicar banner no vídeo',
    payload: { assetId, bannerPath, startMs: window.startMs, endMs: window.endMs, versionId },
    idempotencyKey: `banner:${versionId}`
  }, ctx.clock())
}

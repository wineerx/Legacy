import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { newId, type Db } from '../db/client'
import { workspaceDir, resolveInside } from '../paths'
import { probe } from '../media/probe'
import { validateForReels } from '../media/validate'
import { enqueue } from '../queue/queue'
import { insertAsset, findAssetBySha, getAsset, deleteAssetRow } from '../repos/assets'
import { videoStorage } from './storage'

export type ImportResult = { path: string; status: 'imported' | 'duplicate' | 'rejected'; assetId?: string; errors: string[]; warnings: string[] }

const EXTENSIONS = new Set(['.mp4', '.mov', '.m4v'])

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

export function assetDir(dataRoot: string, workspaceId: string, assetId: string): string {
  return resolveInside(workspaceDir(dataRoot, workspaceId), 'media', assetId)
}

export function storedAssetDir(ctx: Ctx, workspaceId: string, assetId: string): string {
  const asset = getAsset(ctx.db, workspaceId, assetId)
  if (!asset) throw new AppError('not_found', 'Vídeo não encontrado.')
  return dirname(asset.filePath)
}

type Provenance = { origin: 'ig_third_party'; rightsNote: string }

async function importOne(ctx: Ctx, workspaceId: string, path: string, provenance?: Provenance): Promise<ImportResult> {
  const ext = extname(path).toLowerCase()
  if (!EXTENSIONS.has(ext)) return { path, status: 'rejected', errors: ['Formato não aceito. Use MP4, MOV ou M4V.'], warnings: [] }
  try {
    const st = await lstat(path)
    if (st.isSymbolicLink()) return { path, status: 'rejected', errors: ['Atalhos e links não são aceitos. Importe o arquivo original.'], warnings: [] }
    if (!st.isFile()) return { path, status: 'rejected', errors: ['Não foi possível ler o arquivo.'], warnings: [] }
    if (st.size > 1024 ** 3) return { path, status: 'rejected', errors: ['Arquivo acima de 1 GB.'], warnings: [] }
  } catch {
    return { path, status: 'rejected', errors: ['Não foi possível ler o arquivo.'], warnings: [] }
  }
  let sha: string
  try {
    sha = await sha256File(path)
  } catch {
    return { path, status: 'rejected', errors: ['Não foi possível ler o arquivo.'], warnings: [] }
  }
  const existing = findAssetBySha(ctx.db, workspaceId, sha)
  if (existing) return { path, status: 'duplicate', assetId: existing.id, errors: [], warnings: ['Este vídeo já está na biblioteca.'] }

  const id = newId()
  const dir = resolveInside(videoStorage(ctx, workspaceId).path, id)
  const target = join(dir, `original${ext}`)
  await mkdir(dir, { recursive: true })
  try {
    await copyFile(path, target)
    const p = await probe(target, true)
    const v = validateForReels(p)
    ctx.db.transaction((tx) => {
      const t = tx as unknown as Db
      insertAsset(t, {
        id, workspaceId, origin: provenance?.origin ?? 'pc', rightsNote: provenance?.rightsNote, sourceName: basename(path), filePath: target, sha256: sha,
        sizeBytes: p.sizeBytes, durationMs: p.durationMs, width: p.displayWidth, height: p.displayHeight,
        videoCodec: p.videoCodec, audioCodec: p.audioCodec ?? 'none', validationJson: JSON.stringify(v), importedAt: ctx.clock().toISOString()
      })
      enqueue(t, { workspaceId, type: 'make_thumbnail', payload: { assetId: id }, label: `Miniatura de ${basename(path)}`, idempotencyKey: `thumb:${id}` }, ctx.clock())
    }, { behavior: 'immediate' })
    return { path, status: 'imported', assetId: id, errors: v.errors, warnings: v.warnings }
  } catch (e) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      // limpeza é best-effort
    }
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const dup = findAssetBySha(ctx.db, workspaceId, sha)
      if (dup) return { path, status: 'duplicate', assetId: dup.id, errors: [], warnings: ['Este vídeo já está na biblioteca.'] }
    }
    const message = e instanceof AppError && e.code === 'invalid_media' ? e.message : 'O arquivo não parece ser um vídeo válido.'
    return { path, status: 'rejected', errors: [message], warnings: [] }
  }
}

export async function importFiles(ctx: Ctx, workspaceId: string, paths: string[], provenance?: Provenance): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const p of paths) results.push(await importOne(ctx, workspaceId, p, provenance))
  return results
}

export async function deleteAsset(ctx: Ctx, workspaceId: string, id: string): Promise<void> {
  if (!getAsset(ctx.db, workspaceId, id)) throw new AppError('not_found', 'Vídeo não encontrado.')
  const dir = storedAssetDir(ctx, workspaceId, id)
  await rm(dir, { recursive: true, force: true })
  deleteAssetRow(ctx.db, workspaceId, id)
}

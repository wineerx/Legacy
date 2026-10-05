import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { getAsset, listAssets } from '../repos/assets'
import { listJobs } from '../queue/queue'
import { makeTestVideo } from '../media/test-fixtures'
import { importFiles, deleteAsset } from './library'
import type { Ctx } from '../context'

const src = mkdtempSync(join(tmpdir(), 'legacy-src-'))
const video = join(src, 'meu video.mp4')
const notVideo = join(src, 'texto.mp4')
let ctx: Ctx
let ws: string

beforeAll(async () => {
  await makeTestVideo(video)
  writeFileSync(notVideo, 'isto não é vídeo')
})

beforeEach(() => {
  ctx = { db: memDb(), dataRoot: mkdtempSync(join(tmpdir(), 'legacy-data-')), clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
})

describe('importFiles', () => {
  it('copia, sonda, valida e enfileira miniatura', async () => {
    const [r] = await importFiles(ctx, ws, [video])
    expect(r.status).toBe('imported')
    expect(r.errors[0]).toMatch(/Codec mpeg4/)
    const asset = getAsset(ctx.db, ws, r.assetId!)!
    expect(asset).toMatchObject({ origin: 'pc', sourceName: 'meu video.mp4', width: 360, height: 640 })
    expect(existsSync(asset.filePath)).toBe(true)
    expect(asset.filePath.startsWith(ctx.dataRoot)).toBe(true)
    expect(listJobs(ctx.db, ws).map((j) => j.type)).toEqual(['make_thumbnail'])
  })

  it('detecta duplicado pelo conteúdo', async () => {
    await importFiles(ctx, ws, [video])
    const [r] = await importFiles(ctx, ws, [video])
    expect(r.status).toBe('duplicate')
    expect(listAssets(ctx.db, ws)).toHaveLength(1)
  })

  it('rejeita arquivo que não é vídeo e não deixa lixo', async () => {
    const [r] = await importFiles(ctx, ws, [notVideo])
    expect(r.status).toBe('rejected')
    expect(listAssets(ctx.db, ws)).toHaveLength(0)
    const mediaDir = join(ctx.dataRoot, 'workspaces', ws, 'media')
    expect(existsSync(mediaDir) ? readdirSync(mediaDir) : []).toEqual([])
  })

  it('rejeita diretório com nome .mp4', async () => {
    const dir = join(src, 'x.mp4')
    mkdirSync(dir, { recursive: true })
    const [r] = await importFiles(ctx, ws, [dir])
    expect(r).toMatchObject({ status: 'rejected', errors: ['Não foi possível ler o arquivo.'] })
    expect(listAssets(ctx.db, ws)).toHaveLength(0)
  })

  it('importação concorrente do mesmo arquivo gera um só ativo', async () => {
    const rs = (await Promise.all([importFiles(ctx, ws, [video]), importFiles(ctx, ws, [video])])).flat()
    expect(rs.map((r) => r.status).sort()).toEqual(['duplicate', 'imported'])
    expect(listAssets(ctx.db, ws)).toHaveLength(1)
  })

  it('rejeita extensão fora da lista', async () => {
    const [r] = await importFiles(ctx, ws, [join(src, 'x.exe')])
    expect(r).toMatchObject({ status: 'rejected', errors: ['Formato não aceito. Use MP4, MOV ou M4V.'] })
  })

  it('isola workspaces', async () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    const [r] = await importFiles(ctx, ws, [video])
    expect(getAsset(ctx.db, other, r.assetId!)).toBeNull()
    expect(listAssets(ctx.db, other)).toHaveLength(0)
    const [r2] = await importFiles(ctx, other, [video])
    expect(r2.status).toBe('imported')
  })

  it('deleteAsset apaga linha e arquivos', async () => {
    const [r] = await importFiles(ctx, ws, [video])
    const path = getAsset(ctx.db, ws, r.assetId!)!.filePath
    await deleteAsset(ctx, ws, r.assetId!)
    expect(getAsset(ctx.db, ws, r.assetId!)).toBeNull()
    expect(existsSync(path)).toBe(false)
  })
})

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { relative, isAbsolute } from 'node:path'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { importFiles } from './library'
import { makeTestVideo } from '../media/test-fixtures'
import { createFrameTextCover, listCoverTemplates } from '../repos/covers'
import { saveRenderedCover, requestBanner, assertPng } from './versions'
import { latestVersion } from '../repos/assets'
import { listJobs } from '../queue/queue'
import { jobs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { assetDir } from './library'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const src = mkdtempSync(join(tmpdir(), 'legacy-v-'))
const video = join(src, 'v.mp4')
let ctx: Ctx
let ws: string
let assetId: string

beforeAll(async () => { await makeTestVideo(video) })
beforeEach(async () => {
  ctx = { db: memDb(), dataRoot: mkdtempSync(join(tmpdir(), 'legacy-vd-')), clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  assetId = (await importFiles(ctx, ws, [video]))[0].assetId!
})

describe('versões', () => {
  it('assertPng rejeita bytes que não são PNG', () => {
    expect(() => assertPng(new Uint8Array([1, 2, 3]))).toThrow(AppError)
  })
  it('salva capa renderizada como versão', async () => {
    const t = createFrameTextCover(ctx, ws, { name: 'Padrão', frameMs: 1000, text: { text: 'EP 1', position: 'bottom', fontSizePct: 8, color: '#FFFFFF', background: '#000000AA' } })
    expect(listCoverTemplates(ctx.db, ws)).toHaveLength(1)
    const v = await saveRenderedCover(ctx, ws, assetId, t.id, PNG)
    expect(existsSync(v.filePath)).toBe(true)
    expect(latestVersion(ctx.db, ws, assetId, 'cover_png')?.id).toBe(v.id)
  })
  it('banner grava PNG e enfileira job', async () => {
    const job = await requestBanner(ctx, ws, assetId, PNG, { startMs: 0, endMs: 2000 })
    expect(job.type).toBe('apply_banner')
    expect(listJobs(ctx.db, ws).filter((j) => j.type === 'apply_banner')).toHaveLength(1)
    const payload = JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.payloadJson)
    expect(payload).toMatchObject({ assetId, startMs: 0, endMs: 2000 })
    expect(existsSync(payload.bannerPath)).toBe(true)
    const rel = relative(join(assetDir(ctx.dataRoot, ws, assetId), 'versions'), payload.bannerPath)
    expect(rel.startsWith('..') || isAbsolute(rel)).toBe(false)
  })
  it('banner com janela inválida falha', async () => {
    await expect(requestBanner(ctx, ws, assetId, PNG, { startMs: 3000, endMs: 1000 })).rejects.toBeInstanceOf(AppError)
  })
  it('asset de outro workspace não aceita versão', async () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    await expect(saveRenderedCover(ctx, other, assetId, 'x', PNG)).rejects.toBeInstanceOf(AppError)
  })
})

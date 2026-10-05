import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { importFiles } from './library'
import { makeTestVideo } from '../media/test-fixtures'
import { saveRenderedCover } from './versions'
import { requestTiktokExport, runTiktokExport } from './export-tiktok'
import { addNotification, listNotifications } from '../repos/notifications'
import { AppError } from '@shared/errors'
import { insertAsset } from '../repos/assets'
import { jobs } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../context'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const src = mkdtempSync(join(tmpdir(), 'legacy-e-'))
const v1 = join(src, 'a.mp4')
const v2 = join(src, 'b.mp4')
let ctx: Ctx
let ws: string
let ids: string[]

beforeAll(async () => {
  await makeTestVideo(v1, { seconds: 4 })
  await makeTestVideo(v2, { seconds: 5 })
})
beforeEach(async () => {
  ctx = { db: memDb(), dataRoot: mkdtempSync(join(tmpdir(), 'legacy-ed-')), clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  ids = (await importFiles(ctx, ws, [v1, v2])).map((r) => r.assetId!)
})

describe('exportação TikTok', () => {
  it('requestTiktokExport bloqueia vídeo com erro de validação', () => {
    expect(() => requestTiktokExport(ctx, ws, { assetIds: ids, captions: {}, stripMetadata: true, remindAt: [null, null] })).toThrow(/não pode ser exportado/)
  })

  it('runTiktokExport cria pastas, legenda com BOM, capa e lembretes', async () => {
    await saveRenderedCover(ctx, ws, ids[0], 't', PNG)
    const out = await runTiktokExport(ctx, ws, {
      assetIds: ids, captions: { [ids[0]]: 'Legenda 1 #fyp' }, stripMetadata: true,
      remindAt: ['2026-10-05T15:00:00.000Z', null]
    })
    expect(out.folders).toHaveLength(2)
    expect(out.folders[0]).toMatch(/2026-10-05-01-/)
    expect(existsSync(join(out.folders[0], 'video.mp4'))).toBe(true)
    expect(existsSync(join(out.folders[0], 'capa.png'))).toBe(true)
    expect(existsSync(join(out.folders[1], 'capa.png'))).toBe(false)
    const txt = readFileSync(join(out.folders[0], 'legenda.txt'))
    expect(txt.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(txt.subarray(3).toString('utf8')).toBe('Legenda 1 #fyp')
    const n = listNotifications(ctx.db, ws, new Date('2026-10-05T16:00:00Z'))
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ kind: 'manual_task', dueAt: '2026-10-05T15:00:00.000Z' })
  })

  it('asset de outro workspace falha', async () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    await expect(runTiktokExport(ctx, other, { assetIds: [ids[0]], captions: {}, stripMetadata: false, remindAt: [null] })).rejects.toBeInstanceOf(AppError)
  })

  describe('requestTiktokExport com assets válidos', () => {
    let okIds: string[]
    const base = { captions: {}, stripMetadata: false }
    beforeEach(() => {
      okIds = ['aaaaaaaa-1', 'bbbbbbbb-2'].map((id, n) => insertAsset(ctx.db, {
        id, workspaceId: ws, origin: 'pc', sourceName: `v${n}.mp4`, filePath: join(src, 'a.mp4'), sha256: `sha${n}`,
        sizeBytes: 1, durationMs: 1000, width: 1080, height: 1920, videoCodec: 'h264',
        validationJson: '{"ok":true,"errors":[],"warnings":[]}', importedAt: '2026-10-05T12:00:00.000Z'
      }).id)
    })

    it('normaliza remindAt para UTC no payload enfileirado', () => {
      const job = requestTiktokExport(ctx, ws, { ...base, assetIds: okIds, remindAt: ['2026-10-05T12:00:00-03:00', null] })
      const row = ctx.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!
      expect(JSON.parse(row.payloadJson).remindAt).toEqual(['2026-10-05T15:00:00.000Z', null])
    })

    it('remindAt inválido falha', () => {
      expect(() => requestTiktokExport(ctx, ws, { ...base, assetIds: okIds, remindAt: ['lixo', null] })).toThrow(AppError)
    })

    it('idempotente para pedido idêntico e novo job após nova capa', async () => {
      const req = { ...base, assetIds: okIds, remindAt: [null, null] }
      const a = requestTiktokExport(ctx, ws, req)
      expect(requestTiktokExport(ctx, ws, req).id).toBe(a.id)
      await saveRenderedCover(ctx, ws, okIds[0], 't', PNG)
      expect(requestTiktokExport(ctx, ws, req).id).not.toBe(a.id)
    })

    it('reexportar após concluir cria novo job; enquanto na fila devolve o mesmo', () => {
      const req = { ...base, assetIds: okIds, remindAt: [null, null] }
      const a = requestTiktokExport(ctx, ws, req)
      expect(requestTiktokExport(ctx, ws, req).id).toBe(a.id)
      ctx.db.update(jobs).set({ state: 'done' }).where(eq(jobs.id, a.id)).run()
      const b = requestTiktokExport(ctx, ws, req)
      expect(b.id).not.toBe(a.id)
      expect(requestTiktokExport(ctx, ws, req).id).toBe(b.id)
    })
  })

  it('falha parcial não cria lembretes', async () => {
    await expect(runTiktokExport(ctx, ws, {
      assetIds: [ids[0], 'inexistente'], captions: {}, stripMetadata: false,
      remindAt: ['2026-10-05T15:00:00.000Z', '2026-10-05T16:00:00.000Z']
    })).rejects.toBeInstanceOf(AppError)
    expect(listNotifications(ctx.db, ws, new Date('2027-01-01T00:00:00Z'))).toHaveLength(0)
  })
})

describe('lembretes futuros', () => {
  it('não aparecem na lista antes do horário', () => {
    addNotification(ctx.db, { workspaceId: ws, kind: 'manual_task', title: 't', body: 'b', dueAt: '2026-10-05T15:00:00.000Z' }, ctx.clock())
    expect(listNotifications(ctx.db, ws, new Date('2026-10-05T14:59:00Z'))).toHaveLength(0)
    expect(listNotifications(ctx.db, ws, new Date('2026-10-05T15:00:00Z'))).toHaveLength(1)
  })
})

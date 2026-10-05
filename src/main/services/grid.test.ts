import { describe, it, expect, beforeEach } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl, type Profile } from '../repos/profiles'
import { importMetrics } from './metrics-import'
import { queryGrid } from './grid'
import { insertAsset } from '../repos/assets'
import { enqueue, leaseNext, complete } from '../queue/queue'
import type { Ctx } from '../context'
import { setRemoteFavorite } from '../repos/remote-posts'
import { remotePosts } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { GridQuery } from '@shared/types'

let ctx: Ctx
let ws: string
let profile: Profile

const base = (over: Partial<GridQuery> = {}): GridQuery => ({
  workspaceId: ws, source: 'remote', profileId: profile.id, sortBy: 'views', sortDir: 'desc', limit: 50, offset: 0, ...over
})

beforeEach(() => {
  ctx = { db: memDb(), dataRoot: 'C:\\x', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  profile = addProfileFromUrl(ctx, ws, '@perfil')
  importMetrics(ctx, ws, profile.id, [
    'permalink,posted_at,caption,duration_s,views,likes,comments',
    'https://www.instagram.com/reel/AAAAA1/,2026-09-01T00:00:00Z,Treino #fitness,30,1000,50,5',
    'https://www.instagram.com/reel/AAAAA2/,2026-09-02T00:00:00Z,Viagem #travel,60,,80,9',
    'https://www.instagram.com/reel/AAAAA3/,2026-09-03T00:00:00Z,Treino pesado #FITNESS,15,5000,10,1'
  ].join('\n'), 'csv')
})

const codes = (items: { permalink: string | null }[]) => items.map((i) => i.permalink!.slice(-7, -1))

describe('queryGrid remote', () => {
  it('ordena por views desc com nulos no fim', () => {
    expect(codes(queryGrid(ctx.db, base()).items)).toEqual(['AAAAA3', 'AAAAA1', 'AAAAA2'])
  })
  it('ordena por views asc com nulos no fim', () => {
    expect(codes(queryGrid(ctx.db, base({ sortDir: 'asc' })).items)).toEqual(['AAAAA1', 'AAAAA3', 'AAAAA2'])
  })
  it('ordena por likes', () => {
    expect(codes(queryGrid(ctx.db, base({ sortBy: 'likes' })).items)).toEqual(['AAAAA2', 'AAAAA1', 'AAAAA3'])
  })
  it('filtra por hashtag sem diferenciar maiúsculas e por texto', () => {
    expect(codes(queryGrid(ctx.db, base({ hashtag: 'fitness' })).items)).toEqual(['AAAAA3', 'AAAAA1'])
    expect(codes(queryGrid(ctx.db, base({ text: 'pesado' })).items)).toEqual(['AAAAA3'])
  })
  it('mínimo de views exclui indisponível', () => {
    expect(codes(queryGrid(ctx.db, base({ minViews: 1 })).items)).toEqual(['AAAAA3', 'AAAAA1'])
  })
  it('período e duração', () => {
    expect(codes(queryGrid(ctx.db, base({ from: '2026-09-02T00:00:00Z' })).items)).toEqual(['AAAAA3', 'AAAAA2'])
    expect(codes(queryGrid(ctx.db, base({ maxDurationMs: 30_000 })).items)).toEqual(['AAAAA3', 'AAAAA1'])
  })
  it('paginação, total e nota', () => {
    const page = queryGrid(ctx.db, base({ limit: 2, offset: 2 }))
    expect(page.total).toBe(3)
    expect(page.items).toHaveLength(1)
    expect(page.loadedNote).toBe('Ranking cobre os 3 posts carregados deste perfil.')
  })
  it('métricas e selos', () => {
    const item = queryGrid(ctx.db, base()).items.find((i) => i.permalink!.includes('AAAAA2'))!
    expect(item.metrics).toEqual({ views: null, likes: 80, comments: 9 })
    expect(item.badges).toEqual(['link'])
  })
  it('total filtrado, nota não filtrada', () => {
    const page = queryGrid(ctx.db, base({ minViews: 1 }))
    expect(page.total).toBe(2)
    expect(page.loadedNote).toBe('Ranking cobre os 3 posts carregados deste perfil.')
  })
  it('filtro to', () => {
    expect(codes(queryGrid(ctx.db, base({ to: '2026-09-02T00:00:00Z' })).items)).toEqual(['AAAAA1', 'AAAAA2'])
  })
  it('favoritos e selo favorito', () => {
    const id = queryGrid(ctx.db, base()).items.find((i) => i.permalink!.includes('AAAAA1'))!.id
    setRemoteFavorite(ctx.db, ws, id, true)
    const page = queryGrid(ctx.db, base({ favoritesOnly: true }))
    expect(codes(page.items)).toEqual(['AAAAA1'])
    expect(page.items[0].badges).toEqual(['link', 'favorito'])
  })
  it('selo baixado quando há asset', () => {
    insertAsset(ctx.db, {
      id: 'ax', workspaceId: ws, origin: 'pc', sourceName: 'x.mp4', filePath: 'C:/x/x.mp4', sha256: 'sx', sizeBytes: 1,
      durationMs: 1, width: 1080, height: 1920, videoCodec: 'h264', validationJson: '{}', importedAt: '2026-10-01T00:00:00Z'
    })
    const id = queryGrid(ctx.db, base()).items.find((i) => i.permalink!.includes('AAAAA2'))!.id
    ctx.db.update(remotePosts).set({ assetId: 'ax' }).where(eq(remotePosts.id, id)).run()
    const item = queryGrid(ctx.db, base()).items.find((i) => i.id === id)!
    expect(item.badges).toEqual(['baixado'])
  })
  it('exige profileId', () => {
    expect(() => queryGrid(ctx.db, base({ profileId: undefined }))).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })
  it('isola workspace', () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    expect(queryGrid(ctx.db, base({ workspaceId: other })).items).toEqual([])
  })
})

describe('queryGrid library', () => {
  it('preserva origem/métricas do download e ordena/filtra por métrica', () => {
    insertAsset(ctx.db, { id: 'downloaded', workspaceId: ws, origin: 'ig_third_party', sourceName: 'reel', filePath: 'C:/x/reel.mp4', sha256: 'metric-hash', sizeBytes: 1, durationMs: 1000, width: 1080, height: 1920, videoCodec: 'h264', validationJson: '{}', importedAt: '2026-10-01T00:00:00Z' })
    const post = queryGrid(ctx.db, base()).items.find(i => i.metrics.views === 5000)!
    ctx.db.update(remotePosts).set({ assetId: 'downloaded' }).where(eq(remotePosts.id, post.id)).run()
    const page = queryGrid(ctx.db, base({ source: 'library', profileId: undefined, minLikes: 5, sortBy: 'comments' }))
    expect(page.items[0]).toMatchObject({ sourceProfile: 'perfil', permalink: post.permalink, metrics: { views: 5000, likes: 10, comments: 1 } })
    expect(queryGrid(ctx.db, base({ source: 'library', minLikes: 11 })).total).toBe(0)
  })
  it('lista assets com selo exportado', () => {
    const row = {
      workspaceId: ws, origin: 'pc' as const, sourceName: 'a.mp4', filePath: 'C:\\x\\a.mp4', sha256: 's1', sizeBytes: 1,
      durationMs: 10_000, width: 1080, height: 1920, videoCodec: 'h264', validationJson: '{}', importedAt: '2026-10-01T00:00:00Z'
    }
    insertAsset(ctx.db, { ...row, id: 'a1' })
    insertAsset(ctx.db, { ...row, id: 'a2', sha256: 's2', importedAt: '2026-10-02T00:00:00Z' })
    enqueue(ctx.db, { workspaceId: ws, type: 'export_tiktok', payload: { assetIds: ['a1'] }, label: 'x' }, ctx.clock())
    complete(ctx.db, leaseNext(ctx.db, ctx.clock(), 1000)!, ctx.clock())
    const page = queryGrid(ctx.db, base({ source: 'library', profileId: undefined, sortBy: 'views' }))
    expect(page.items.map((i) => i.id)).toEqual(['a2', 'a1'])
    expect(page.items[1].badges).toEqual(['exportado'])
    expect(page.items[0].metrics).toEqual({ views: null, likes: null, comments: null })
    expect(page.loadedNote).toBe('2 vídeos encontrados na biblioteca.')
    })
  const mk = (id: string, wsId: string, over: object = {}) => insertAsset(ctx.db, {
    id, workspaceId: wsId, origin: 'pc', sourceName: id + '.mp4', filePath: 'C:/x/' + id, sha256: id, sizeBytes: 1,
    durationMs: 10_000, width: 1080, height: 1920, videoCodec: 'h264', validationJson: '{}', importedAt: '2026-10-01T00:00:00Z', ...over
  })
  it('ordena por duração desc', () => {
    mk('d1', ws, { durationMs: 5000 }); mk('d2', ws, { durationMs: 9000 })
    const page = queryGrid(ctx.db, base({ source: 'library', profileId: undefined, sortBy: 'durationMs' }))
    expect(page.items.map((i) => i.id)).toEqual(['d2', 'd1'])
  })
  it('filtro de métrica esvazia, total filtrado e nota', () => {
    mk('m1', ws)
    const page = queryGrid(ctx.db, base({ source: 'library', profileId: undefined, minViews: 1 }))
    expect(page.items).toEqual([])
    expect(page.total).toBe(0)
    expect(page.loadedNote).toBe('0 vídeos encontrados na biblioteca.')
  })
  it('isola workspace', () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    mk('w1', ws)
    expect(queryGrid(ctx.db, base({ source: 'library', profileId: undefined, workspaceId: other })).items).toEqual([])
  })
})

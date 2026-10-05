import { describe, it, expect, beforeEach } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl, listProfiles } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { importMetrics } from './metrics-import'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { metricSnapshots, remotePosts } from '../db/schema'

let ctx: Ctx
let ws: string

beforeEach(() => {
  ctx = { db: memDb(), dataRoot: 'C:\\nao-usado', clock: () => new Date('2026-10-05T12:00:00Z') }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
})

describe('perfis', () => {
  it('normaliza e não duplica', () => {
    const a = addProfileFromUrl(ctx, ws, 'https://www.instagram.com/Zanon.Boss/')
    const b = addProfileFromUrl(ctx, ws, '@zanon.boss')
    expect(a.id).toBe(b.id)
    expect(a).toMatchObject({ username: 'zanon.boss', url: 'https://www.instagram.com/zanon.boss/', connectedAccountId: null })
    expect(listProfiles(ctx.db, ws)).toHaveLength(1)
  })
  it('rejeita link de reel como perfil', () => {
    expect(() => addProfileFromUrl(ctx, ws, 'https://www.instagram.com/reel/DAbc_123/')).toThrow(AppError)
  })
  it('reel vira link_ref sem métricas', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    const r = addReelLink(ctx, ws, p.id, 'instagram.com/reel/DAbc_123/?x=1')
    expect(r).toMatchObject({ permalink: 'https://www.instagram.com/reel/DAbc_123/', views: null, likes: null, comments: null, assetId: null })
  })
})

describe('importMetrics', () => {
  it('CSV com vazios como null e erros por linha', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    const csv = [
      'permalink;posted_at;caption;duration_s;views;likes;comments',
      'https://www.instagram.com/reel/AAAAA1/;2026-09-01T10:00:00Z;Naruto #anime;42;1.203.000;84.000;1203',
      'https://www.instagram.com/reel/AAAAA2/;;;;;10;',
      'https://www.instagram.com/reel/AAAAA3/;;;;abc;1;1',
      'https://evil.com/x;;;;1;1;1'
    ].join('\n')
    const rep = importMetrics(ctx, ws, p.id, csv, 'csv')
    expect(rep.upserted).toBe(2)
    expect(rep.rows.filter((r) => r.error).map((r) => r.line)).toEqual([4, 5])
    const ids = ctx.db.select().from(metricSnapshots).all()
    expect(ids.length).toBe(6)
    const first = rep.rows[0].permalink!
    expect(first).toBe('https://www.instagram.com/reel/AAAAA1/')
    const posts = ctx.db.select().from(remotePosts).all()
    const a1 = posts.find((r) => r.permalink.endsWith('AAAAA1/'))!
    const a2 = posts.find((r) => r.permalink.endsWith('AAAAA2/'))!
    expect(a1).toMatchObject({ views: 1203000, likes: 84000, comments: 1203, postedAt: '2026-09-01T10:00:00.000Z', durationMs: 42000 })
    expect(a2).toMatchObject({ views: null, likes: 10, comments: null })
  })

  it('reimportação parcial preserva métricas ausentes', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    importMetrics(ctx, ws, p.id, 'permalink,views,likes\nhttps://www.instagram.com/reel/AAAAA1/,10,5', 'csv')
    importMetrics(ctx, ws, p.id, 'permalink,likes\nhttps://www.instagram.com/reel/AAAAA1/,7', 'csv')
    const row = ctx.db.select().from(remotePosts).all()[0]
    expect(row).toMatchObject({ views: 10, likes: 7 })
    const snaps = ctx.db.select().from(metricSnapshots).all()
    expect(snaps.filter((s) => s.metric === 'views').map((s) => s.value)).toEqual([10])
  })

  it('reimportar atualiza (upsert) e mantém histórico', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    importMetrics(ctx, ws, p.id, 'permalink,views\nhttps://www.instagram.com/reel/AAAAA1/,10', 'csv')
    importMetrics(ctx, ws, p.id, 'permalink,views\nhttps://www.instagram.com/reel/AAAAA1/,20', 'csv')
    const all = ctx.db.select().from(metricSnapshots).all()
    expect(all.filter((s) => s.metric === 'views').map((s) => s.value)).toEqual([10, 20])
    const posts = ctx.db.select().from(remotePosts).all()
    expect(posts).toHaveLength(1)
    expect(posts[0].views).toBe(20)
  })

  it('JSON', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    const rep = importMetrics(ctx, ws, p.id, JSON.stringify([{ permalink: 'https://www.instagram.com/reel/AAAAA9/', views: 5, likes: null }]), 'json')
    expect(rep.upserted).toBe(1)
  })

  it('perfil de outro workspace é rejeitado', () => {
    const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
    const p = addProfileFromUrl(ctx, other, '@zanon.boss')
    expect(() => importMetrics(ctx, ws, p.id, 'permalink\nhttps://www.instagram.com/reel/AAAAA1/', 'csv')).toThrow(AppError)
  })

  it('sem coluna permalink falha inteiro', () => {
    const p = addProfileFromUrl(ctx, ws, '@zanon.boss')
    expect(() => importMetrics(ctx, ws, p.id, 'views\n1', 'csv')).toThrow(/permalink/)
  })
})

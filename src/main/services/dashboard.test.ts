import { expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { jobs, remotePosts } from '../db/schema'
import { enqueue } from '../queue/queue'
import { addNotification, dueUnshown, markAllRead } from '../repos/notifications'
import { dashboard } from './dashboard'
import { topCaptions } from './captions'

it('isola indicadores e ranqueia só métricas conhecidas preservando zeros', () => {
  const ctx = { db: memDb(), dataRoot: 'unused', clock: () => new Date('2026-10-05T12:00:00Z') }
  const ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  const p = addProfileFromUrl(ctx, ws, '@example')
  const q = addProfileFromUrl(ctx, other, '@secret')
  const posts = ['ABCDE', 'ABCDF', 'ABCDG'].map((code) => addReelLink(ctx, ws, p.id, `https://instagram.com/reel/${code}/`))
  posts.forEach((post, i) => ctx.db.update(remotePosts).set({ caption: `legenda-${i}`, views: i === 0 ? null : i === 1 ? 0 : 12, likes: null }).where(eq(remotePosts.id, post.id)).run())
  const privatePost = addReelLink(ctx, other, q.id, 'https://instagram.com/reel/ABCDH/')
  ctx.db.update(remotePosts).set({ views: 9999, caption: 'private-caption' }).where(eq(remotePosts.id, privatePost.id)).run()
  enqueue(ctx.db, { workspaceId: ws, type: 'fetch_profile', payload: {}, label: 'Public task' }, ctx.clock())
  enqueue(ctx.db, { workspaceId: other, type: 'fetch_profile', payload: {}, label: 'Private task' }, ctx.clock())
  enqueue(ctx.db, { workspaceId: ws, type: 'webhook_delivery', payload: {}, label: 'Internal webhook' }, ctx.clock())
  addNotification(ctx.db, { workspaceId: ws, kind: 'info', title: 'New', body: 'x' }, ctx.clock())
  const data = dashboard(ctx, ws)
  expect(data.tasks).toMatchObject({ queued: 1, total: 1 })
  expect(data.profiles).toHaveLength(1)
  expect(data.profiles[0]).toMatchObject({ views: 12, viewsKnown: 2, posts: 3, likes: null, likesKnown: 0 })
  expect(data.unread).toBe(1)
  expect(topCaptions(ctx, ws, 'views').items.map((r) => r.value)).toEqual([12, 0])
  expect(topCaptions(ctx, ws, 'likes').items).toEqual([])
  expect(JSON.stringify(data)).not.toContain('private-caption')
  markAllRead(ctx.db, other, ctx.clock())
  expect(dashboard(ctx, ws).unread).toBe(1)
  expect(dueUnshown(ctx.db, ctx.clock())).toHaveLength(1)
  markAllRead(ctx.db, ws, ctx.clock())
  expect(dueUnshown(ctx.db, ctx.clock())).toEqual([])
})

it('analytics agrupa por dia local, isola workspaces e não inventa métricas', () => {
  const ctx = { db: memDb(), dataRoot: 'unused', clock: () => new Date('2026-10-05T12:00:00Z') }
  const ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
  const other = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  const p = addProfileFromUrl(ctx, ws, '@example')
  const [known, unknown] = ['ABCDE', 'ABCDF'].map((code) => addReelLink(ctx, ws, p.id, `https://instagram.com/reel/${code}/`))
  ctx.db.update(remotePosts).set({ views: 50, likes: 5 }).where(eq(remotePosts.id, known.id)).run()
  const q = addProfileFromUrl(ctx, other, '@secret')
  const hidden = addReelLink(ctx, other, q.id, 'https://instagram.com/reel/ABCDG/')
  ctx.db.update(remotePosts).set({ views: 9999 }).where(eq(remotePosts.id, hidden.id)).run()
  // 02:00 UTC on the 5th is still the 4th in São Paulo.
  enqueue(ctx.db, { workspaceId: ws, type: 'fetch_profile', payload: {}, label: 'Falhou' }, new Date('2026-10-05T02:00:00Z'))
  ctx.db.update(jobs).set({ state: 'failed', updatedAt: '2026-10-05T02:00:00.000Z' }).where(eq(jobs.workspaceId, ws)).run()
  const a = dashboard(ctx, ws).analytics
  expect(a.activity).toHaveLength(14)
  expect(a.activity.at(-1)!.day).toBe('2026-10-05')
  expect(a.activity.find(d => d.day === '2026-10-04')!.failed).toBe(1)
  expect(a.activity.reduce((n, d) => n + d.published + d.imported, 0)).toBe(0)
  expect(a.jobTypes).toEqual([{ type: 'fetch_profile', done: 0, failed: 1, total: 1 }])
  expect(a.topPosts.map(t => t.id)).toEqual([known.id])
  expect(a.topPosts[0]).toMatchObject({ views: 50, likes: 5, comments: null })
  expect(a.topPosts.some(t => t.id === unknown.id)).toBe(false)
  expect(JSON.stringify(a)).not.toContain('9999')
})

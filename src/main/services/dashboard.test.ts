import { expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { addProfileFromUrl } from '../repos/profiles'
import { addReelLink } from '../repos/remote-posts'
import { remotePosts } from '../db/schema'
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

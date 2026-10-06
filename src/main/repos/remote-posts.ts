import { and, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { normalizeSocialUrl } from '@shared/social-url'
import type { Ctx } from '../context'
import { type Db, newId } from '../db/client'
import { remotePosts } from '../db/schema'
import { getProfile } from './profiles'

export type RemotePost = typeof remotePosts.$inferSelect

export function getRemotePost(db: Db, workspaceId: string, id: string): RemotePost | null {
  return db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, workspaceId), eq(remotePosts.id, id))).get() ?? null
}

export function findByPermalink(db: Db, workspaceId: string, permalink: string): RemotePost | null {
  return db.select().from(remotePosts).where(and(eq(remotePosts.workspaceId, workspaceId), eq(remotePosts.permalink, permalink))).get() ?? null
}

export function addReelLink(ctx: Ctx, workspaceId: string, profileId: string, input: string): RemotePost {
  if (!getProfile(ctx.db, workspaceId, profileId)) throw new AppError('not_found', 'Perfil não encontrado.')
  const ref = normalizeSocialUrl(input)
  if (ref.kind === 'profile') throw new AppError('invalid_url', 'Cole o link de um reel ou post.')
  const profile = getProfile(ctx.db, workspaceId, profileId)!
  if (profile.platform !== ref.platform) throw new AppError('invalid_url', 'A plataforma do vídeo é diferente da plataforma do perfil.')
  const existing = findByPermalink(ctx.db, workspaceId, ref.url)
  if (existing) return existing
  return ctx.db.insert(remotePosts).values({
    id: newId(), workspaceId, profileId, permalink: ref.url, mediaProductType: ref.kind === 'reel' ? 'REELS' : null
  }).returning().get()
}

export function setRemoteFavorite(db: Db, workspaceId: string, id: string, favorite: boolean): void {
  db.update(remotePosts).set({ favorite }).where(and(eq(remotePosts.workspaceId, workspaceId), eq(remotePosts.id, id))).run()
}

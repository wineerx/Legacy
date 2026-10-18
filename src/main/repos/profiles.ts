import { and, asc, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { normalizeSocialUrl } from '@shared/social-url'
import type { Ctx } from '../context'
import { type Db, newId } from '../db/client'
import { trackedProfiles } from '../db/schema'

export type Profile = typeof trackedProfiles.$inferSelect

export function addProfileFromUrl(ctx: Ctx, workspaceId: string, input: string): Profile {
  const ref = normalizeSocialUrl(input)
  if (ref.kind !== 'profile') throw new AppError('invalid_url', 'Esse é o link de um post. Cole o link do perfil (instagram.com/usuario ou tiktok.com/@usuario).')
  const existing = ctx.db.select().from(trackedProfiles).where(and(
    eq(trackedProfiles.workspaceId, workspaceId), eq(trackedProfiles.platform, ref.platform), eq(trackedProfiles.username, ref.username)
  )).get()
  if (existing) return existing
  return ctx.db.insert(trackedProfiles).values({
    id: newId(), workspaceId, platform: ref.platform, username: ref.username, url: ref.url, createdAt: ctx.clock().toISOString()
  }).returning().get()
}

export function listProfiles(db: Db, workspaceId: string): Profile[] {
  return db.select().from(trackedProfiles).where(eq(trackedProfiles.workspaceId, workspaceId)).orderBy(asc(trackedProfiles.createdAt)).all()
}

export function getProfile(db: Db, workspaceId: string, id: string): Profile | null {
  return db.select().from(trackedProfiles).where(and(eq(trackedProfiles.workspaceId, workspaceId), eq(trackedProfiles.id, id))).get() ?? null
}

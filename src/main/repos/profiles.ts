import { and, asc, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { normalizeSocialUrl } from '@shared/social-url'
import type { Ctx } from '../context'
import { type Db, newId } from '../db/client'
import { trackedProfiles } from '../db/schema'
import { getSetting, setSetting } from './settings'

export type Profile = typeof trackedProfiles.$inferSelect

export function addProfileFromUrl(ctx: Ctx, workspaceId: string, input: string): Profile {
  const ref = normalizeSocialUrl(input)
  if (ref.kind !== 'profile') throw new AppError('invalid_url', 'Esse é o link de um post. Cole o link do perfil (instagram.com/usuario ou tiktok.com/@usuario).')
  const existing = ctx.db.select().from(trackedProfiles).where(and(
    eq(trackedProfiles.workspaceId, workspaceId), eq(trackedProfiles.platform, ref.platform), eq(trackedProfiles.username, ref.username)
  )).get()
  if (existing) {
    setSetting(ctx.db, workspaceId, `profileArchived.${existing.id}`, 'false')
    return existing
  }
  return ctx.db.insert(trackedProfiles).values({
    id: newId(), workspaceId, platform: ref.platform, username: ref.username, url: ref.url, createdAt: ctx.clock().toISOString()
  }).returning().get()
}

export function listProfiles(db: Db, workspaceId: string, archived = false): Profile[] {
  return db.select().from(trackedProfiles).where(eq(trackedProfiles.workspaceId, workspaceId)).orderBy(asc(trackedProfiles.createdAt)).all()
    .filter(p => (getSetting(db, workspaceId, `profileArchived.${p.id}`) === 'true') === archived)
}

export function archiveProfile(ctx: Ctx, workspaceId: string, id: string, archived: boolean): void {
  if (!getProfile(ctx.db, workspaceId, id)) throw new AppError('not_found', 'Perfil não encontrado.')
  setSetting(ctx.db, workspaceId, `profileArchived.${id}`, String(archived))
}

export function getProfile(db: Db, workspaceId: string, id: string): Profile | null {
  return db.select().from(trackedProfiles).where(and(eq(trackedProfiles.workspaceId, workspaceId), eq(trackedProfiles.id, id))).get() ?? null
}

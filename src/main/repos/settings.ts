import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { settings } from '../db/schema'

export function getSetting(db: Db, workspaceId: string, key: string): string | null {
  return db.select().from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key))).get()?.value ?? null
}

export function setSetting(db: Db, workspaceId: string, key: string, value: string): void {
  db.insert(settings).values({ workspaceId, key, value })
    .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value } }).run()
}

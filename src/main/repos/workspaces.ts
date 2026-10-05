import { asc, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { type Db, newId, nowIso } from '../db/client'
import { workspaces } from '../db/schema'

export type Workspace = typeof workspaces.$inferSelect

function assertTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
  } catch {
    throw new AppError('invalid_input', `Fuso horário inválido: ${tz}`)
  }
}

export function createWorkspace(db: Db, input: { name: string; timeZone: string }): Workspace {
  const name = input.name.trim()
  if (!name) throw new AppError('invalid_input', 'Dê um nome ao workspace.')
  assertTimeZone(input.timeZone)
  return db.insert(workspaces).values({ id: newId(), name, timeZone: input.timeZone, createdAt: nowIso() }).returning().get()
}

export function listWorkspaces(db: Db): Workspace[] {
  return db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).all()
}

export function getWorkspace(db: Db, id: string): Workspace | null {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get() ?? null
}

export function ensureDefaultWorkspace(db: Db, timeZone: string): Workspace {
  return listWorkspaces(db)[0] ?? createWorkspace(db, { name: 'Meu workspace', timeZone })
}

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { randomUUID } from 'node:crypto'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export function openDb(file: string, migrationsFolder: string): { db: Db; close(): void } {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return { db, close: () => sqlite.close() }
}

export const newId = (): string => randomUUID()
export const nowIso = (clock: () => Date = () => new Date()): string => clock().toISOString()

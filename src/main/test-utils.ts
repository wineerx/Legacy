import { resolve } from 'node:path'
import { openDb, type Db } from './db/client'

export const MIGRATIONS_DIR = resolve('src/main/db/migrations')
export function memDb(): Db {
  return openDb(':memory:', MIGRATIONS_DIR).db
}

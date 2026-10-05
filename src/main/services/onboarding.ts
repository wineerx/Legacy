import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { coverTemplates, jobs, mediaAssets } from '../db/schema'
import { getSetting } from '../repos/settings'

export interface OnboardingStep { key: 'workspace' | 'connect_instagram' | 'import_videos' | 'cover' | 'first_batch'; label: string; done: boolean; disabledReason?: string }

const count = (db: Db, table: typeof mediaAssets | typeof coverTemplates, ws: string) =>
  db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.workspaceId, ws)).get()!.n

export function onboardingStatus(db: Db, ws: string): OnboardingStep[] {
  const exports = db.select({ n: sql<number>`count(*)` }).from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'export_tiktok'))).get()!.n
  return [
    { key: 'workspace', label: 'Criar workspace', done: true },
    { key: 'connect_instagram', label: 'Conectar Instagram', done: Boolean(getSetting(db, ws, 'instagramAccount') && getSetting(db, ws, 'secret.instagramToken')), disabledReason: getSetting(db, ws, 'instagramAccount') ? undefined : 'Configure a conta profissional por token em Contas.' },
    { key: 'import_videos', label: 'Importar 3 vídeos', done: count(db, mediaAssets, ws) >= 3 },
    { key: 'cover', label: 'Criar uma capa', done: count(db, coverTemplates, ws) >= 1 },
    { key: 'first_batch', label: 'Preparar o primeiro lote', done: exports >= 1 }
  ]
}

import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { coverTemplates, jobs, mediaAssets, trackedProfiles } from '../db/schema'
import { getSetting, setSetting } from '../repos/settings'

export interface OnboardingStep { key: string; label: string; done: boolean; disabledReason?: string }
export function onboardingStatus(db: Db, ws: string): OnboardingStep[] {
  const count = (table: typeof mediaAssets | typeof trackedProfiles | typeof coverTemplates) => db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.workspaceId, ws)).get()!.n
  const hasJob = (type: string) => !!db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, type))).limit(1).get()
  const current: OnboardingStep[] = [
    { key: 'connect_instagram', label: 'Conectar primeira conta', done: Boolean(getSetting(db, ws, 'instagramAccount') && getSetting(db, ws, 'secret.instagramToken')), disabledReason: getSetting(db, ws, 'instagramAccount') ? undefined : 'Configure a conta profissional por token em Contas.' },
    { key: 'profile', label: 'Adicionar primeiro perfil', done: count(trackedProfiles) > 0 },
    { key: 'import_videos', label: 'Importar primeiro vídeo', done: count(mediaAssets) > 0 },
    { key: 'first_batch', label: 'Preparar primeira postagem', done: hasJob('export_tiktok') || hasJob('publish_instagram') },
    { key: 'schedule', label: 'Criar primeiro agendamento', done: hasJob('publish_instagram') }
  ]
  const previous = JSON.parse(getSetting(db, ws, 'onboardingCompleted') ?? '[]') as string[]
  const completed = [...new Set([...previous, ...current.filter(s => s.done).map(s => s.key)])]
  if (JSON.stringify(previous) !== JSON.stringify(completed)) setSetting(db, ws, 'onboardingCompleted', JSON.stringify(completed))
  return current.map(s => ({ ...s, done: completed.includes(s.key) }))
}

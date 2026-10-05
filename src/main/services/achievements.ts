import { and, eq } from 'drizzle-orm'
import type { AchievementSummary, Challenge } from '@shared/achievements'
import { streakFor } from '@shared/achievements'
import type { Ctx } from '../context'
import { jobs, remotePosts, trackedProfiles, workspaces } from '../db/schema'
import { history } from './publication-history'
import { requireWorkspace } from './integrations'
import { getSetting } from '../repos/settings'

export function achievements(ctx: Ctx, ws: string): AchievementSummary {
  requireWorkspace(ctx, ws)
  const records = history(ctx, ws)
  const zone = ctx.db.select().from(workspaces).where(eq(workspaces.id, ws)).get()!.timeZone
  const accounts = [...new Set(records.map(r => r.accountId))]
  const streaks = accounts.map(id => ({ username: records.find(r => r.accountId === id)!.username, ...streakFor(records.filter(r => r.accountId === id).map(r => r.publishedAt), ctx.clock(), zone) }))
  const completed = ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'download_reel'), eq(jobs.state, 'done'))).all()
  const downloads = new Set(completed.flatMap(j => { try { const r = JSON.parse(j.resultJson ?? '{}'); return r.assetId ? [r.assetId] : [] } catch { return [] } })).size
  const profiles = ctx.db.select().from(trackedProfiles).where(eq(trackedProfiles.workspaceId, ws)).all().length
  const posts = ctx.db.select().from(remotePosts).where(eq(remotePosts.workspaceId, ws)).all()
  const acknowledged = JSON.parse(getSetting(ctx.db, ws, 'acknowledgedAchievements') ?? '[]') as string[]
  const challenge = (id: string, title: string, description: string, current: number, target: number): Challenge => ({ id, title, description, current: acknowledged.includes(id) ? target : Math.min(current, target), target, unlocked: acknowledged.includes(id) || current >= target })
  return { streaks, challenges: [
    challenge('download-first', 'Primeiro download', 'Baixe um vídeo pelo Legacy.', downloads, 1),
    challenge('download-10', 'Coleção em movimento', 'Conclua 10 downloads distintos.', downloads, 10),
    challenge('profiles-3', 'Radar de conteúdo', 'Acompanhe 3 perfis.', profiles, 3),
    challenge('viral-100k', 'Radar viral', 'Carregue um post com 100 mil views conhecidas.', Math.max(0, ...posts.map(p => p.views ?? 0)), 100000),
    challenge('publish-first', 'Estreia confirmada', 'Publique um reel com confirmação da API.', records.length, 1),
    challenge('publish-10', 'Lote concluído', 'Acumule 10 publicações confirmadas.', records.length, 10),
    challenge('streak-3', 'Ofensiva de 3 dias', 'Publique por 3 dias seguidos na mesma conta.', Math.max(0, ...streaks.map(s => s.best)), 3),
    challenge('streak-7', 'Semana presente', 'Publique por 7 dias seguidos na mesma conta.', Math.max(0, ...streaks.map(s => s.best)), 7)
  ] }
}

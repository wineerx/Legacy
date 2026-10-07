import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { ProfileMetrics } from '@shared/ipc-contract'
import type { Ctx } from '../context'
import { trackedProfiles } from '../db/schema'
import { getProfile } from '../repos/profiles'
import { getSetting, setSetting } from '../repos/settings'
import { getSecret } from './integrations'
import { apifyJson } from './download-http'

const runSchema = z.object({ data: z.object({ id: z.string().regex(/^[a-zA-Z0-9]+$/), status: z.string(), defaultDatasetId: z.string().regex(/^[a-zA-Z0-9]+$/).optional() }) })
const metric = z.number().int().nonnegative().nullable().catch(null)
const metricsSchema = z.object({ postsCount: metric, reelsCount: metric, followersCount: metric, followingCount: metric, updatedAt: z.string() })
const pending = new Set<string>()

export function profileMetrics(ctx: Ctx, ws: string, id: string): ProfileMetrics | null {
  try { return metricsSchema.parse(JSON.parse(getSetting(ctx.db, ws, `profileMetrics.${id}`) ?? 'null')) } catch { return null }
}

export async function refreshProfile(ctx: Ctx, ws: string, id: string): Promise<ProfileMetrics> {
  const profile = getProfile(ctx.db, ws, id)
  if (!profile) throw new AppError('invalid_input', 'Perfil não encontrado.')
  if (profile.platform !== 'instagram') throw new AppError('invalid_input', 'Atualização de dados disponível para Instagram.')
  const key = getSecret(ctx, ws, 'apifyToken')
  if (!key) throw new AppError('invalid_input', 'Configure a chave Apify para atualizar o perfil.')
  const lock = `${ws}:${id}`
  if (pending.has(lock)) throw new AppError('invalid_input', 'Este perfil já está sendo atualizado.')
  pending.add(lock)
  try {
    const checkpointKey = `profileRefreshRun.${id}`
    const checkpoint = z.object({ starting: z.boolean().optional(), runId: z.string().regex(/^[a-zA-Z0-9]+$/).optional() }).nullable().parse(JSON.parse(getSetting(ctx.db, ws, checkpointKey) ?? 'null'))
    if (checkpoint?.starting && !checkpoint.runId) throw new AppError('invalid_input', 'A consulta anterior ficou sem confirmação. Confira a execução na Apify antes de iniciar outra busca.')
    let run: z.infer<typeof runSchema>['data']
    if (checkpoint?.runId) run = runSchema.parse(await apifyJson(`actor-runs/${checkpoint.runId}?waitForFinish=60`, key)).data
    else {
      setSetting(ctx.db, ws, checkpointKey, JSON.stringify({ starting: true }))
      run = runSchema.parse(await apifyJson('actors/apify~instagram-scraper/runs?timeout=600', key, {
        directUrls: [profile.url], resultsType: 'details', resultsLimit: 1
      })).data
      setSetting(ctx.db, ws, checkpointKey, JSON.stringify({ runId: run.id }))
    }
    for (let attempt = 0; attempt < 12 && ['READY', 'RUNNING'].includes(run.status); attempt++) {
      run = runSchema.parse(await apifyJson(`actor-runs/${run.id}?waitForFinish=60`, key)).data
    }
    if (!['READY', 'RUNNING', 'SUCCEEDED'].includes(run.status)) setSetting(ctx.db, ws, checkpointKey, 'null')
    if (run.status !== 'SUCCEEDED' || !run.defaultDatasetId) throw new AppError('invalid_input', `A consulta do perfil não concluiu (${run.status}).`)
    // Ignore any embedded latestPosts: this operation never imports content or queues downloads.
    const details = z.array(z.object({
      username: z.string().regex(/^[a-zA-Z0-9_.]{1,30}$/),
      postsCount: metric, reelsCount: metric, followersCount: metric, followsCount: metric,
      error: z.unknown().optional()
    })).parse(await apifyJson(`datasets/${run.defaultDatasetId}/items?clean=true&limit=1`, key))[0]
    if (!details || details.error) throw new AppError('invalid_input', 'O provedor não retornou os dados do perfil.')
    const metrics: ProfileMetrics = {
      postsCount: details.postsCount, reelsCount: details.reelsCount,
      followersCount: details.followersCount, followingCount: details.followsCount,
      updatedAt: ctx.clock().toISOString()
    }
    ctx.db.transaction(() => {
      ctx.db.update(trackedProfiles).set({ username: details.username, url: `https://www.instagram.com/${details.username}/` })
        .where(and(eq(trackedProfiles.workspaceId, ws), eq(trackedProfiles.id, id))).run()
      setSetting(ctx.db, ws, `profileMetrics.${id}`, JSON.stringify(metrics))
      setSetting(ctx.db, ws, checkpointKey, 'null')
    })
    return metrics
  } finally { pending.delete(lock) }
}

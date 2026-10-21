import { and, asc, eq, gt, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { jobs, jobAttempts, providerLimits, publicationHistory } from '../db/schema'
import { ownedJob, type LeasedJob } from '../queue/queue'
import { getWorkspace } from '../repos/workspaces'
import { readQuotaSnapshot } from './instagram-quota'
import { formatQuotaWindow } from '@shared/quota'

export const PUBLICATION_QUOTA = 'publication_quota'
/** Existing safe policy when Meta has not reported a window: estimate with 24 hours and say it is an estimate. */
const FALLBACK_WINDOW_MS = 24 * 60 * 60_000

/** Local history estimates a slot; Meta remains authoritative, including posts from other apps. */
export function publicationResumeAt(ctx: Ctx, ws: string, accountId: string, retryAfterMs = 0, windowMs = FALLBACK_WINDOW_MS) {
  const now = ctx.clock().getTime()
  const oldest = ctx.db.select({ at: publicationHistory.publishedAt }).from(publicationHistory)
    .where(and(eq(publicationHistory.workspaceId, ws), eq(publicationHistory.accountId, accountId),
      gt(publicationHistory.publishedAt, new Date(now - windowMs).toISOString())))
    .orderBy(asc(publicationHistory.publishedAt)).limit(1).get()
  // No local history cannot establish an exact reset; probe again in one hour.
  return new Date(Math.max(now + 60_000, now + retryAfterMs,
    oldest ? Date.parse(oldest.at) + windowMs + 60_000 : now + 60 * 60_000)).toISOString()
}

export type PublicationLimitCause = 'meta_refusal' | 'quota_snapshot'
export interface PublicationLimitInfo { resumeAt: string; estimated: boolean; cause: PublicationLimitCause; checkedAt: string | null; windowSec: number | null; usage: number | null; total: number | null }

/**
 * Persist the account gate and move the whole pending sequence atomically, without burning retries.
 * `known` comes from the proactive check on a fresh Meta reading; otherwise this is a refusal by Meta.
 */
export function deferPublicationAccount(ctx: Ctx, job: LeasedJob, retryAfterMs?: number, known?: { resumeAt: string; checkedAt: string }): string | null {
  const p = job.payload as { accountId?: string; username?: string }
  if (!p.accountId) return null
  const now = ctx.clock(), iso = now.toISOString(), accountId = p.accountId
  return ctx.db.transaction(tx => {
    if (!tx.select({ id: jobs.id }).from(jobs).where(ownedJob(tx, job, now)).get()) return null
    const key = { workspaceId: job.workspaceId, provider: 'instagram', accountId, operation: PUBLICATION_QUOTA }
    const previous = tx.select().from(providerLimits).where(and(eq(providerLimits.workspaceId, key.workspaceId),
      eq(providerLimits.provider, key.provider), eq(providerLimits.accountId, accountId), eq(providerLimits.operation, PUBLICATION_QUOTA))).get()
    // A fresh reading (refreshed right after the refusal, or the one that triggered the wait) supplies the window.
    const reading = readQuotaSnapshot(tx, job.workspaceId, accountId, now)
    const fresh = reading?.freshness === 'fresh' ? reading : null
    const windowMs = fresh ? fresh.durationSec! * 1000 : FALLBACK_WINDOW_MS
    const resumeAt = new Date(Math.max(Date.parse(publicationResumeAt({ ...ctx, db: tx }, job.workspaceId, accountId, retryAfterMs, windowMs)),
      known ? Date.parse(known.resumeAt) : 0, previous ? Date.parse(previous.cooldownUntil) : 0)).toISOString()
    tx.insert(providerLimits).values({ ...key, cooldownUntil: resumeAt, failures: (previous?.failures ?? 0) + 1 })
      .onConflictDoUpdate({ target: [providerLimits.workspaceId, providerLimits.provider, providerLimits.accountId, providerLimits.operation],
        set: { cooldownUntil: resumeAt, failures: (previous?.failures ?? 0) + 1 } }).run()
    const pending = tx.select().from(jobs).where(and(eq(jobs.workspaceId, job.workspaceId), eq(jobs.type, 'publish_instagram'),
      sql`json_extract(${jobs.payloadJson}, '$.accountId') = ${accountId}`,
      sql`(${jobs.state} = 'queued' or ${jobs.id} = ${job.id})`)).orderBy(asc(jobs.runAt), asc(jobs.createdAt), asc(jobs.id)).all()
    const scheduledAt = (row: typeof jobs.$inferSelect) => row.id === job.id
      ? JSON.parse(row.resultJson ?? '{}').publicationLimit?.resumeAt ?? JSON.parse(row.payloadJson).publishAt ?? row.runAt
      : row.runAt
    const offset = Math.max(0, Date.parse(resumeAt) - Math.min(...pending.map(row => Date.parse(scheduledAt(row)))))
    const timeZone = getWorkspace(tx, job.workspaceId)?.timeZone ?? 'UTC'
    const when = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'short' })
    const who = `@${p.username ?? accountId}`
    const message = known
      ? `Quota da conta ${who} esgotada segundo a Meta (consulta de ${when(known.checkedAt)}: ${fresh?.usage ?? '—'}/${fresh?.total ?? '—'} em ${fresh ? formatQuotaWindow(fresh.durationSec!) : '—'}). Publicação adiada sem consumir tentativas.`
      : fresh
        ? `A Meta recusou a publicação por limite da conta ${who} (consulta de ${when(fresh.fetchedAt!)}: ${fresh.usage}/${fresh.total} em ${formatQuotaWindow(fresh.durationSec!)}). Publicação adiada automaticamente.`
        : `A Meta recusou a publicação por limite da conta ${who}. Sem leitura válida da quota; retomada estimada por 24 horas. Publicação adiada automaticamente.`
    const info = (runAt: string): PublicationLimitInfo => ({ resumeAt: runAt, estimated: true, cause: known ? 'quota_snapshot' : 'meta_refusal',
      checkedAt: fresh?.fetchedAt ?? null, windowSec: fresh?.durationSec ?? null, usage: fresh?.usage ?? null, total: fresh?.total ?? null })
    for (const row of pending) {
      const runAt = new Date(Date.parse(scheduledAt(row)) + offset).toISOString()
      const checkpoint = JSON.parse(row.resultJson ?? '{}')
      checkpoint.publicationLimit = info(runAt)
      tx.update(jobs).set({ runAt, resultJson: JSON.stringify(checkpoint), updatedAt: iso,
        ...(row.id === job.id ? { state: 'queued' as const, leaseUntil: null, attempts: Math.max(0, job.attempts - 1), lastError: message } : {}) })
        .where(eq(jobs.id, row.id)).run()
    }
    tx.update(jobAttempts).set({ finishedAt: iso, outcome: 'retry', errorCode: PUBLICATION_QUOTA,
      errorMessage: known ? 'Quota esgotada segundo consulta recente à Meta; nenhum envio foi tentado.' : `Limite de publicações da conta atingido (Meta 9 / 2207042). ${fresh ? `Janela informada pela Meta: ${formatQuotaWindow(fresh.durationSec!)}.` : 'Retomada estimada por 24 horas, sem leitura válida da quota.'}` })
      .where(eq(jobAttempts.id, job.attemptId)).run()
    return resumeAt
  }, { behavior: 'immediate' })
}

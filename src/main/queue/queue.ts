import { and, asc, desc, eq, inArray, isNull, lte, lt, sql, count, ne } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { JobState, JobType, JobView, QueuePageResult } from '@shared/types'
import { type Db, newId } from '../db/client'
import { jobs, jobAttempts, publicationHistory, remotePosts, mediaAssets, settings } from '../db/schema'
import { queueContext, loadQueueRelations, queuePriority, queueVisible } from '../services/queue-monitor'
import { setSetting } from '../repos/settings'
import { pipelineConfig } from '../pipeline-config'
import { recordDiagnostic } from '../diagnostics'
import { containerClaimGate, assertContainerRetryAllowed, settleCancelledContainers, isContainerJob } from '../services/container-control'
import { publishUncertain } from '@shared/publication-containers'

export function traceLease(db: Db, jobId: string, expectedLease: number, operation: string, accepted: boolean) {
  if(process.env.LEGACY_PERF_DEBUG !== '1') return
  const row=db.select({actualLease:jobs.leaseVersion,state:jobs.state,nextRunAt:jobs.runAt,workspaceId:jobs.workspaceId}).from(jobs).where(eq(jobs.id,jobId)).get()
  recordDiagnostic({workspaceId:row?.workspaceId,taskId:jobId,source:'lease',level:accepted?'DEBUG':'WARN',message:`${operation}: ${accepted?'accepted':'rejected'}`,metadata:{workerId:`worker-${process.pid}`,expectedLease,actualLease:row?.actualLease,operation,accepted,state:row?.state,nextRunAt:row?.nextRunAt}})
}

export interface LeasedJob extends JobView { payload: unknown; attemptId: string; leaseVersion: number }

type Row = typeof jobs.$inferSelect

function toView(r: Row): JobView {
  return {
    id: r.id, workspaceId: r.workspaceId, type: r.type as JobType, state: r.state, attempts: r.attempts,
    maxAttempts: r.maxAttempts, runAt: r.runAt, lastError: r.lastError, label: r.label,
    createdAt: r.createdAt, updatedAt: r.updatedAt
  }
}

const IMMEDIATE = { behavior: 'immediate' } as const

export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  return Math.min(2 ** attempt * 1000, 600_000) + Math.floor(rand() * 1000)
}

export function enqueue(
  db: Db,
  input: { workspaceId: string; type: JobType; payload: unknown; label: string; runAt?: Date; idempotencyKey?: string; maxAttempts?: number },
  now: Date
): JobView {
  const key = input.idempotencyKey
  const findByKey = (): JobView | null => {
    if (!key) return null
    const existing = db.select().from(jobs).where(eq(jobs.idempotencyKey, key)).get()
    if (!existing) return null
    if (existing.workspaceId !== input.workspaceId) {
      throw new AppError('duplicate', 'Chave de idempotência já usada em outro workspace.')
    }
    return toView(existing)
  }
  const found = findByKey()
  if (found) return found
  const iso = now.toISOString()
  const row = db.insert(jobs).values({
    id: newId(), workspaceId: input.workspaceId, type: input.type, payloadJson: JSON.stringify(input.payload),
    label: input.label, state: 'queued', runAt: (input.runAt ?? now).toISOString(),
    maxAttempts: input.maxAttempts ?? 5, idempotencyKey: input.idempotencyKey ?? null,
    createdAt: iso, updatedAt: iso
  }).onConflictDoNothing().returning().get()
  if (!row) {
    const raced = findByKey()
    if (raced) return raced
    throw new AppError('internal', 'Falha ao enfileirar o job.')
  }
  return toView(row)
}

export function leaseNext(db: Db, now: Date, leaseMs: number): LeasedJob | null {
  const iso = now.toISOString()
  return db.transaction((tx) => {
    settleCancelledContainers(tx,now)
    const row = tx.select().from(jobs)
      .where(and(eq(jobs.state, 'queued'), lte(jobs.runAt, iso), containerClaimGate, sql`(${jobs.type} != 'publish_instagram' or (
        (select count(*) from jobs active where active.type = 'publish_instagram' and active.state = 'running') < ${pipelineConfig.providerConcurrency}
        and (select count(*) from jobs active where active.type = 'publish_instagram' and active.state = 'running' and active.workspace_id = ${jobs.workspaceId} and json_extract(active.payload_json, '$.accountId') is json_extract(${jobs.payloadJson}, '$.accountId')) < ${pipelineConfig.accountConcurrency}
        and not exists(select 1 from provider_limits lim where lim.workspace_id = ${jobs.workspaceId} and lim.provider = 'instagram' and (lim.account_id = '' or lim.account_id = json_extract(${jobs.payloadJson}, '$.accountId')) and lim.cooldown_until > ${iso})
        and not exists(select 1 from jobs earlier where earlier.workspace_id = ${jobs.workspaceId} and earlier.type = 'publish_instagram' and earlier.state = 'queued'
          and json_extract(earlier.payload_json, '$.accountId') = json_extract(${jobs.payloadJson}, '$.accountId')
          and (json_extract(earlier.result_json, '$.publicationLimit') is not null or json_extract(${jobs.resultJson}, '$.publicationLimit') is not null)
          and (coalesce(json_extract(earlier.result_json, '$.publicationLimit.resumeAt'), earlier.run_at) < coalesce(json_extract(${jobs.resultJson}, '$.publicationLimit.resumeAt'), ${jobs.runAt})
            or (coalesce(json_extract(earlier.result_json, '$.publicationLimit.resumeAt'), earlier.run_at) = coalesce(json_extract(${jobs.resultJson}, '$.publicationLimit.resumeAt'), ${jobs.runAt})
              and (earlier.created_at < ${jobs.createdAt} or (earlier.created_at = ${jobs.createdAt} and earlier.id < ${jobs.id})))))
      ))`))
      .orderBy(desc(queuePriority), asc(jobs.runAt), asc(jobs.createdAt)).limit(1).get()
    if (!row) return null
    const updated = tx.update(jobs).set({
      state: 'running', attempts: row.attempts + 1,
      leaseVersion: row.leaseVersion + 1,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: iso
    }).where(and(eq(jobs.id, row.id), eq(jobs.state, 'queued'))).returning().get()
    if (!updated) return null
    const attemptId = newId()
    tx.insert(jobAttempts).values({ id: attemptId, jobId: row.id, startedAt: iso }).run()
    return { ...toView(updated), payload: JSON.parse(updated.payloadJson), attemptId, leaseVersion: updated.leaseVersion }
  }, IMMEDIATE)
}

export function heartbeat(db: Db, jobId: string, now: Date, leaseMs: number, leaseVersion: number): boolean {
  const accepted=db.update(jobs).set({ leaseUntil: new Date(now.getTime() + leaseMs).toISOString() })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, 'running'), eq(jobs.leaseVersion, leaseVersion), sql`${jobs.leaseUntil} >= ${now.toISOString()}`)).run().changes > 0
  traceLease(db,jobId,leaseVersion,'heartbeat',accepted)
  return accepted
}

export function ownedJob(db: Db, job: LeasedJob, now: Date) {
  return and(eq(jobs.id,job.id),eq(jobs.workspaceId,job.workspaceId),eq(jobs.state,'running'),eq(jobs.leaseVersion,job.leaseVersion),sql`${jobs.leaseUntil} >= ${now.toISOString()}`)
}

/** Polling is not a failed attempt; persist next check and free the slot. */
export function deferJob(db: Db, job: LeasedJob, now: Date, delayMs: number): boolean {
  const accepted=db.transaction(tx => {
    const changed=tx.update(jobs).set({state:'queued',leaseUntil:null,runAt:new Date(now.getTime()+delayMs).toISOString(),attempts:Math.max(0,job.attempts-1),updatedAt:now.toISOString()}).where(ownedJob(tx,job,now)).run().changes
    if(changed) tx.update(jobAttempts).set({finishedAt:now.toISOString(),outcome:'retry',errorCode:'provider_pending'}).where(eq(jobAttempts.id,job.attemptId)).run()
    return changed>0
  },IMMEDIATE)
  traceLease(db,job.id,job.leaseVersion,'defer',accepted)
  return accepted
}

export function complete(db: Db, job: LeasedJob, now: Date, result?: unknown): boolean {
  const iso = now.toISOString()
  const accepted=db.transaction((tx) => {
    const r = tx.update(jobs).set({ state: 'done', leaseUntil: null, lastError: null, resultJson: result === undefined ? null : JSON.stringify(result), updatedAt: iso })
      .where(ownedJob(tx, job, now)).run()
    if (r.changes === 0) return false
    tx.update(jobAttempts).set({ finishedAt: iso, outcome: 'ok' }).where(eq(jobAttempts.id, job.attemptId)).run()
    return true
  }, IMMEDIATE)
  traceLease(db,job.id,job.leaseVersion,'complete',accepted)
  return accepted
}

export function fail(
  db: Db, job: LeasedJob, now: Date,
  err: { code: string; message: string; permanent?: boolean; retryAfterMs?: number },
  rand: () => number = Math.random
): 'retry' | 'failed' | 'stale' {
  const iso = now.toISOString()
  const final = err.permanent === true || job.attempts >= job.maxAttempts
  const delay = Math.max(err.retryAfterMs ?? 0, backoffMs(job.attempts, rand))
  const changed = db.transaction((tx) => {
    const r = tx.update(jobs).set({
      state: final ? 'failed' : 'queued', leaseUntil: null, lastError: err.message, updatedAt: iso,
      runAt: final ? job.runAt : new Date(now.getTime() + delay).toISOString()
    }).where(ownedJob(tx, job, now)).run()
    if (r.changes === 0) return false
    tx.update(jobAttempts).set({ finishedAt: iso, outcome: final ? 'failed' : 'retry', errorCode: err.code, errorMessage: err.message })
      .where(eq(jobAttempts.id, job.attemptId)).run()
    return true
  }, IMMEDIATE)
  traceLease(db,job.id,job.leaseVersion,'fail/retry',changed)
  if (!changed) return 'stale'
  return final ? 'failed' : 'retry'
}

export function recoverExpired(db: Db, now: Date): number {
  const iso = now.toISOString()
  return db.transaction((tx) => {
    const expired = tx.select({ id: jobs.id, attempts: jobs.attempts, maxAttempts: jobs.maxAttempts }).from(jobs).where(and(eq(jobs.state, 'running'), lt(jobs.leaseUntil, iso))).all()
    for (const { id, attempts, maxAttempts } of expired) {
      const poison = attempts >= maxAttempts
      tx.update(jobs).set(poison
        ? { state: 'failed', leaseUntil: null, lastError: 'O processamento foi interrompido repetidamente.', updatedAt: iso }
        : { state: 'queued', leaseUntil: null, updatedAt: iso }).where(eq(jobs.id, id)).run()
      tx.update(jobAttempts).set({ finishedAt: iso, outcome: 'lease_expired' })
        .where(and(eq(jobAttempts.jobId, id), isNull(jobAttempts.outcome))).run()
    }
    return expired.length
  }, IMMEDIATE)
}

export function cancel(db: Db, workspaceId: string, jobId: string, now: Date): boolean {
  const row = db.select().from(jobs).where(and(eq(jobs.workspaceId,workspaceId),eq(jobs.id,jobId))).get()
  if (row && isContainerJob(db,workspaceId,jobId) && publishUncertain(JSON.parse(row.resultJson ?? '{}'))) return false
  const r = db.update(jobs).set({ state: 'cancelled', updatedAt: now.toISOString() })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), inArray(jobs.state, ['queued', 'failed']))).run()
  return r.changes > 0
}

export function retryNow(db: Db, workspaceId: string, jobId: string, now: Date): boolean {
  const row = db.select().from(jobs).where(and(eq(jobs.workspaceId,workspaceId),eq(jobs.id,jobId))).get()
  if (row) assertContainerRetryAllowed(db,workspaceId,jobId,JSON.parse(row.resultJson ?? '{}'))
  const iso = now.toISOString()
  const r = db.update(jobs).set({ state: 'queued', attempts: 0, runAt: iso, lastError: null, updatedAt: iso })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), eq(jobs.state, 'failed'))).run()
  return r.changes > 0
}

export function listJobs(db: Db, workspaceId: string, states?: JobState[]): JobView[] {
  const where = states?.length ? and(eq(jobs.workspaceId, workspaceId), inArray(jobs.state, states)) : eq(jobs.workspaceId, workspaceId)
  return db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt)).limit(500).all().map(toView)
}

export function queryJobs(db: Db, input: { workspaceId: string; page: number; pageSize: number; search: string; state?: JobState; type?: JobType; batchId?: string; platform?: string; source?: string; destination?: string; worker?: string; priority?: number; from?: string; to?: string; error?: string; retries?: boolean; attention?: boolean; sort?: 'created' | 'scheduled' | 'priority' }): QueuePageResult {
  const term = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
  const profileId = sql`coalesce(json_extract(${jobs.payloadJson}, '$.profileId'), (select profile_id from remote_posts where workspace_id = ${jobs.workspaceId} and (id = json_extract(${jobs.payloadJson}, '$.postId') or asset_id = coalesce(json_extract(${jobs.payloadJson}, '$.localAssetId'), json_extract(${jobs.payloadJson}, '$.assetId'))) limit 1))`
  const source = sql`(select username from tracked_profiles where workspace_id = ${jobs.workspaceId} and id = ${profileId})`
  const platform = sql`case when ${jobs.type} = 'publish_instagram' then 'instagram' when ${jobs.type} = 'export_tiktok' then 'tiktok' when ${jobs.type} = 'webhook_delivery' then 'webhook' else coalesce((select platform from tracked_profiles where workspace_id = ${jobs.workspaceId} and id = ${profileId}), 'local') end`
  const base = and(eq(jobs.workspaceId, input.workspaceId), queueVisible,
    input.platform ? sql`${platform} = ${input.platform}` : undefined,
    input.source ? sql`${source} like ${'%' + input.source.replace(/^@/, '').replace(/[\\%_]/g, '\\$&') + '%'} escape '\\'` : undefined,
    input.destination ? sql`json_extract(${jobs.payloadJson}, '$.username') like ${'%' + input.destination.replace(/^@/, '').replace(/[\\%_]/g, '\\$&') + '%'} escape '\\'` : undefined,
    input.worker ? eq(jobs.state, 'running') : undefined,
    input.priority !== undefined ? sql`${queuePriority} = ${input.priority}` : undefined,
    input.from ? sql`${jobs.runAt} >= ${input.from}` : undefined,
    input.to ? sql`${jobs.runAt} <= ${input.to}` : undefined,
    input.error ? sql`${jobs.lastError} like ${'%' + input.error.replace(/[\\%_]/g, '\\$&') + '%'} escape '\\'` : undefined,
    input.retries ? sql`${jobs.attempts} > 0 and ${jobs.lastError} is not null and ${jobs.state} = 'queued'` : undefined,
    input.attention ? sql`(${jobs.state} = 'failed' or (${jobs.state} = 'running' and ${jobs.leaseUntil} < ${new Date().toISOString()}))` : undefined,
    input.type ? eq(jobs.type, input.type) : undefined,
    input.search ? sql`(${jobs.label} like ${term} escape '\\' or ${jobs.id} like ${term} escape '\\' or json_extract(${jobs.payloadJson}, '$.username') like ${term} escape '\\' or ${source} like ${term} escape '\\' or exists(select 1 from media_assets where workspace_id = ${jobs.workspaceId} and id = coalesce(json_extract(${jobs.payloadJson}, '$.localAssetId'), json_extract(${jobs.payloadJson}, '$.assetId')) and source_name like ${term} escape '\\') or exists(select 1 from remote_posts where workspace_id = ${jobs.workspaceId} and (id = json_extract(${jobs.payloadJson}, '$.postId') or asset_id = coalesce(json_extract(${jobs.payloadJson}, '$.localAssetId'), json_extract(${jobs.payloadJson}, '$.assetId'))) and (caption like ${term} escape '\\' or id like ${term} escape '\\' or remote_id like ${term} escape '\\')))` : undefined,
    input.batchId ? sql`(${jobs.id} = ${input.batchId} or json_extract(${jobs.payloadJson}, '$.batchId') = ${input.batchId})` : undefined)
  const counts: QueuePageResult['counts'] = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
  for (const r of db.select({ state: jobs.state, n: count() }).from(jobs).where(base).groupBy(jobs.state).all()) counts[r.state] = r.n
  const total = input.state ? counts[input.state] : Object.values(counts).reduce((a,b) => a+b,0)
  const page = Math.min(input.page, Math.max(1, Math.ceil(total/input.pageSize)))
  const rows = db.select().from(jobs).where(and(base, input.state ? eq(jobs.state,input.state) : undefined))
    .orderBy(input.sort === 'scheduled' ? asc(jobs.runAt) : input.sort === 'priority' ? desc(queuePriority) : desc(jobs.createdAt), desc(jobs.id)).limit(input.pageSize).offset((page-1)*input.pageSize).all()
  const relations = loadQueueRelations(db, rows), now = new Date()
  const items = rows.map(r => {
      const payload = JSON.parse(r.payloadJson)
      const k = (id: string) => relations.key(input.workspaceId, id)
      const publication = relations.publications.get(k(r.id))
      const origin = publication ? JSON.parse(publication.provenanceJson) : null
      const post = publication?.postId ? relations.posts.get(k(publication.postId)) : null
      const assetId = post?.assetId ?? origin?.assetId ?? payload.localAssetId
      const asset = assetId ? relations.assets.get(k(assetId)) : null
      return { context: queueContext(db, r, now, relations), publishedVideo: publication ? { assetId: asset?.id ?? null, name: post?.caption ?? asset?.sourceName ?? origin?.caption ?? origin?.sourceName ?? 'Vídeo publicado' } : null, ...toView(r), batchId: typeof payload.batchId === 'string' ? payload.batchId : null, account: typeof payload.username === 'string' ? payload.username : null }
    })
  return { items, total, page, pageSize: input.pageSize, counts }
}

function movable(db: Db, workspaceId: string, id: string) {
  const row = db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id,id))).get()
  if (!row || !['queued','failed'].includes(row.state)) throw new AppError('invalid_input', 'A tarefa mudou ou já iniciou. Atualize a fila.')
  return row
}

/** Publications move behind queued publications for the same destination, never reset remote checkpoints. */
export function tailSlot(db: Db, workspaceId: string, id: string, now: Date) {
  const row = movable(db, workspaceId, id)
  const payload = JSON.parse(row.payloadJson)
  const peers = db.select({ runAt: jobs.runAt }).from(jobs).where(and(eq(jobs.workspaceId,workspaceId),
    ne(jobs.id,id), eq(jobs.state,'queued'), eq(jobs.type,row.type),
    row.type === 'publish_instagram' ? sql`json_extract(${jobs.payloadJson}, '$.accountId') is ${payload.accountId ?? null}` : undefined)).all()
  const last = peers.reduce((ms,p) => Math.max(ms, new Date(p.runAt).getTime()),now.getTime())
  const runAt = new Date(Math.ceil((last+15*60000)/60000)*60000).toISOString()
  if (new Date(runAt).getTime() > now.getTime()+90*86400000) throw new AppError('invalid_input','O final da fila ultrapassa 90 dias. Escolha outro horário.')
  return { runAt, ahead: peers.length }
}

export function reschedule(db: Db, workspaceId: string, id: string, runAt: string, expectedUpdatedAt: string, now: Date): boolean {
  const ms = new Date(runAt).getTime()
  if (!Number.isFinite(ms) || ms < now.getTime()+60000 || ms > now.getTime()+90*86400000) throw new AppError('invalid_input','Escolha um horário entre um minuto e 90 dias no futuro.')
  return db.transaction(tx => {
    const row = movable(tx,workspaceId,id)
    assertContainerRetryAllowed(tx,workspaceId,id,JSON.parse(row.resultJson ?? '{}'))
    if (row.updatedAt !== expectedUpdatedAt) throw new AppError('invalid_input','A tarefa mudou. Reabra o agendamento.')
    tx.update(jobs).set({ state:'queued', runAt, attempts: row.state === 'failed' ? 0 : row.attempts, lastError:null, updatedAt:now.toISOString() })
      .where(and(eq(jobs.workspaceId,workspaceId),eq(jobs.id,id),inArray(jobs.state,['queued','failed']))).run()
    return true
  }, IMMEDIATE)
}


/** Bulk operations are scoped, revision checked and never reset remote publication checkpoints. */
export function operateJobs(db: Db, workspaceId: string, items: { id: string; updatedAt: string }[], action: 'cancel' | 'retry' | 'run_now' | 'priority' | 'remove' | 'recover', now: Date, priority = 0) {
  const changed: string[] = []
  const skipped: { id: string; reason: string }[] = []
  return db.transaction(tx => {
    for (const item of items) {
      const row = tx.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, item.id))).get()
      let reason = ''
      if (!row) reason = 'Tarefa não encontrada.'
      else if (row.updatedAt !== item.updatedAt) reason = 'A tarefa mudou. Atualize a seleção.'
      else if (action === 'cancel') { if (!cancel(tx, workspaceId, item.id, now)) reason = 'Somente tarefas na fila ou com falha podem ser canceladas.' }
      else if (action === 'retry') { if (!retryNow(tx, workspaceId, item.id, now)) reason = 'Somente falhas podem ser reprocessadas.' }
      else if (action === 'priority') {
        if (row.state !== 'queued') reason = 'A prioridade só pode mudar antes da execução.'
        else { setSetting(tx, workspaceId, `jobPriority.${row.id}`, String(priority)); tx.update(jobs).set({ priority, updatedAt: now.toISOString() }).where(eq(jobs.id, row.id)).run() }
      } else if (action === 'run_now') {
        if (row.state !== 'queued') reason = 'Somente tarefas na fila podem ser antecipadas.'
        else tx.update(jobs).set({ runAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(jobs.id, row.id)).run()
      } else if (action === 'remove') {
        if (!['done','failed','cancelled'].includes(row.state)) reason = 'Finalize ou cancele antes de remover do monitor.'
        else setSetting(tx, workspaceId, `jobHidden.${row.id}`, 'true')
      } else if (action === 'recover') {
        if (row.state !== 'running' || !row.leaseUntil || row.leaseUntil >= now.toISOString()) reason = 'A execução ainda possui uma lease válida.'
        else {
          tx.update(jobs).set({ state: row.attempts >= row.maxAttempts ? 'failed' : 'queued', leaseUntil: null, updatedAt: now.toISOString() }).where(eq(jobs.id, row.id)).run()
          tx.update(jobAttempts).set({ finishedAt: now.toISOString(), outcome: 'lease_expired' }).where(and(eq(jobAttempts.jobId, row.id), isNull(jobAttempts.outcome))).run()
        }
      }
      if (reason) skipped.push({ id: item.id, reason }); else changed.push(item.id)
    }
    return { changed, skipped }
  }, IMMEDIATE)
}

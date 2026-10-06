import { and, asc, desc, eq, inArray, isNull, lte, lt, sql, count, ne } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { JobState, JobType, JobView, QueuePageResult } from '@shared/types'
import { type Db, newId } from '../db/client'
import { jobs, jobAttempts } from '../db/schema'

export interface LeasedJob extends JobView { payload: unknown; attemptId: string }

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
    const row = tx.select().from(jobs)
      .where(and(eq(jobs.state, 'queued'), lte(jobs.runAt, iso)))
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt)).limit(1).get()
    if (!row) return null
    const updated = tx.update(jobs).set({
      state: 'running', attempts: row.attempts + 1,
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: iso
    }).where(and(eq(jobs.id, row.id), eq(jobs.state, 'queued'))).returning().get()
    if (!updated) return null
    const attemptId = newId()
    tx.insert(jobAttempts).values({ id: attemptId, jobId: row.id, startedAt: iso }).run()
    return { ...toView(updated), payload: JSON.parse(updated.payloadJson), attemptId }
  }, IMMEDIATE)
}

export function heartbeat(db: Db, jobId: string, now: Date, leaseMs: number): void {
  db.update(jobs).set({ leaseUntil: new Date(now.getTime() + leaseMs).toISOString() })
    .where(and(eq(jobs.id, jobId), eq(jobs.state, 'running'))).run()
}

export function complete(db: Db, job: LeasedJob, now: Date, result?: unknown): boolean {
  const iso = now.toISOString()
  return db.transaction((tx) => {
    const r = tx.update(jobs).set({ state: 'done', leaseUntil: null, lastError: null, resultJson: result === undefined ? null : JSON.stringify(result), updatedAt: iso })
      .where(and(eq(jobs.id, job.id), eq(jobs.state, 'running'), eq(jobs.attempts, job.attempts))).run()
    if (r.changes === 0) return false
    tx.update(jobAttempts).set({ finishedAt: iso, outcome: 'ok' }).where(eq(jobAttempts.id, job.attemptId)).run()
    return true
  }, IMMEDIATE)
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
    }).where(and(eq(jobs.id, job.id), eq(jobs.state, 'running'), eq(jobs.attempts, job.attempts))).run()
    if (r.changes === 0) return false
    tx.update(jobAttempts).set({ finishedAt: iso, outcome: final ? 'failed' : 'retry', errorCode: err.code, errorMessage: err.message })
      .where(eq(jobAttempts.id, job.attemptId)).run()
    return true
  }, IMMEDIATE)
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
  const r = db.update(jobs).set({ state: 'cancelled', updatedAt: now.toISOString() })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), inArray(jobs.state, ['queued', 'failed']))).run()
  return r.changes > 0
}

export function retryNow(db: Db, workspaceId: string, jobId: string, now: Date): boolean {
  const iso = now.toISOString()
  const r = db.update(jobs).set({ state: 'queued', attempts: 0, runAt: iso, lastError: null, updatedAt: iso })
    .where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId), eq(jobs.state, 'failed'))).run()
  return r.changes > 0
}

export function listJobs(db: Db, workspaceId: string, states?: JobState[]): JobView[] {
  const where = states?.length ? and(eq(jobs.workspaceId, workspaceId), inArray(jobs.state, states)) : eq(jobs.workspaceId, workspaceId)
  return db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt)).limit(500).all().map(toView)
}

export function queryJobs(db: Db, input: { workspaceId: string; page: number; pageSize: number; search: string; state?: JobState; type?: JobType; batchId?: string }): QueuePageResult {
  const term = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
  const base = and(eq(jobs.workspaceId, input.workspaceId),
    input.type ? eq(jobs.type, input.type) : undefined,
    input.search ? sql`(${jobs.label} like ${term} escape '\\' or ${jobs.id} like ${term} escape '\\' or json_extract(${jobs.payloadJson}, '$.username') like ${term} escape '\\')` : undefined,
    input.batchId ? sql`(${jobs.id} = ${input.batchId} or json_extract(${jobs.payloadJson}, '$.batchId') = ${input.batchId})` : undefined)
  const counts: QueuePageResult['counts'] = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 }
  for (const r of db.select({ state: jobs.state, n: count() }).from(jobs).where(base).groupBy(jobs.state).all()) counts[r.state] = r.n
  const total = input.state ? counts[input.state] : Object.values(counts).reduce((a,b) => a+b,0)
  const page = Math.min(input.page, Math.max(1, Math.ceil(total/input.pageSize)))
  const items = db.select().from(jobs).where(and(base, input.state ? eq(jobs.state,input.state) : undefined))
    .orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(input.pageSize).offset((page-1)*input.pageSize).all().map(r => {
      const payload = JSON.parse(r.payloadJson)
      return { ...toView(r), batchId: typeof payload.batchId === 'string' ? payload.batchId : null, account: typeof payload.username === 'string' ? payload.username : null }
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
    if (row.updatedAt !== expectedUpdatedAt) throw new AppError('invalid_input','A tarefa mudou. Reabra o agendamento.')
    tx.update(jobs).set({ state:'queued', runAt, attempts: row.state === 'failed' ? 0 : row.attempts, lastError:null, updatedAt:now.toISOString() })
      .where(and(eq(jobs.workspaceId,workspaceId),eq(jobs.id,id),inArray(jobs.state,['queued','failed']))).run()
    return true
  }, IMMEDIATE)
}

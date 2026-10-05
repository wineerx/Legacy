import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import { memDb, MIGRATIONS_DIR } from '../test-utils'
import { openDb } from '../db/client'
import { createWorkspace } from '../repos/workspaces'
import type { Db } from '../db/client'
import { enqueue, leaseNext, complete, fail, recoverExpired, cancel, retryNow, listJobs, backoffMs, heartbeat } from './queue'

const t0 = new Date('2026-10-05T12:00:00Z')
const at = (ms: number) => new Date(t0.getTime() + ms)
let db: Db
let ws: string

beforeEach(() => {
  db = memDb()
  ws = createWorkspace(db, { name: 'A', timeZone: 'UTC' }).id
})

describe('fila', () => {
  it('enfileira e entrega em ordem de runAt', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: { n: 2 }, label: 'b', runAt: at(1000) }, t0)
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: { n: 1 }, label: 'a' }, t0)
    const j = leaseNext(db, at(2000), 30_000)
    expect(j?.payload).toEqual({ n: 1 })
    expect(j?.state).toBe('running')
    expect(j?.attempts).toBe(1)
  })

  it('não entrega job futuro', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x', runAt: at(60_000) }, t0)
    expect(leaseNext(db, t0, 30_000)).toBeNull()
  })

  it('não entrega o mesmo job duas vezes (lease)', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    expect(leaseNext(db, t0, 30_000)).not.toBeNull()
    expect(leaseNext(db, t0, 30_000)).toBeNull()
  })

  it('idempotência devolve o job existente', () => {
    const a = enqueue(db, { workspaceId: ws, type: 'export_tiktok', payload: {}, label: 'x', idempotencyKey: 'k1' }, t0)
    const b = enqueue(db, { workspaceId: ws, type: 'export_tiktok', payload: {}, label: 'x', idempotencyKey: 'k1' }, t0)
    expect(b.id).toBe(a.id)
    expect(listJobs(db, ws)).toHaveLength(1)
  })

  it('falha transitória reagenda com backoff; esgotada vira failed', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x', maxAttempts: 2 }, t0)
    const j1 = leaseNext(db, t0, 30_000)!
    expect(fail(db, j1, t0, { code: 'io', message: 'falhou' }, () => 0)).toBe('retry')
    expect(leaseNext(db, at(1000), 30_000)).toBeNull()
    const j2 = leaseNext(db, at(2000), 30_000)!
    expect(j2.attempts).toBe(2)
    expect(fail(db, j2, at(2000), { code: 'io', message: 'falhou de novo' }, () => 0)).toBe('failed')
    expect(listJobs(db, ws)[0]).toMatchObject({ state: 'failed', lastError: 'falhou de novo' })
  })

  it('erro permanente falha na hora', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const j = leaseNext(db, t0, 30_000)!
    expect(fail(db, j, t0, { code: 'invalid_media', message: 'arquivo corrompido', permanent: true })).toBe('failed')
  })

  it('respeita retryAfterMs', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const j = leaseNext(db, t0, 30_000)!
    fail(db, j, t0, { code: 'rate', message: 'limite', retryAfterMs: 120_000 }, () => 0)
    expect(leaseNext(db, at(119_000), 30_000)).toBeNull()
    expect(leaseNext(db, at(120_000), 30_000)).not.toBeNull()
  })

  it('recupera lease vencido após reinício e heartbeat estende', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const j = leaseNext(db, t0, 30_000)!
    heartbeat(db, j.id, at(20_000), 30_000)
    expect(recoverExpired(db, at(40_000))).toBe(0)
    expect(recoverExpired(db, at(51_000))).toBe(1)
    expect(leaseNext(db, at(51_000), 30_000)?.id).toBe(j.id)
  })

  it('complete marca done', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const j = leaseNext(db, t0, 30_000)!
    complete(db, j, t0, { ok: 1 })
    expect(listJobs(db, ws)[0].state).toBe('done')
  })

  it('cancel só afeta queued do próprio workspace', () => {
    const other = createWorkspace(db, { name: 'B', timeZone: 'UTC' }).id
    const job = enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    expect(cancel(db, other, job.id, t0)).toBe(false)
    expect(cancel(db, ws, job.id, t0)).toBe(true)
    expect(leaseNext(db, t0, 30_000)).toBeNull()
  })

  it('retryNow reabre job failed', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const j = leaseNext(db, t0, 30_000)!
    fail(db, j, t0, { code: 'x', message: 'x', permanent: true })
    expect(retryNow(db, ws, j.id, t0)).toBe(true)
    expect(leaseNext(db, t0, 30_000)?.attempts).toBe(1)
  })

  it('backoff cresce e tem teto', () => {
    expect(backoffMs(1, () => 0)).toBe(2000)
    expect(backoffMs(3, () => 0)).toBe(8000)
    expect(backoffMs(30, () => 0)).toBe(600_000)
  })

  it('job que estourou tentativas e perdeu o lease vira failed', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x', maxAttempts: 1 }, t0)
    leaseNext(db, t0, 30_000)!
    expect(recoverExpired(db, at(31_000))).toBe(1)
    expect(listJobs(db, ws)[0]).toMatchObject({ state: 'failed', lastError: 'O processamento foi interrompido repetidamente.' })
  })

  it('complete obsoleto não afeta o novo lease', () => {
    enqueue(db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
    const old = leaseNext(db, t0, 30_000)!
    recoverExpired(db, at(31_000))
    const fresh = leaseNext(db, at(31_000), 30_000)!
    expect(complete(db, old, at(32_000))).toBe(false)
    expect(fail(db, old, at(32_000), { code: 'x', message: 'x', permanent: true })).toBe('stale')
    expect(listJobs(db, ws)[0].state).toBe('running')
    complete(db, fresh, at(33_000))
    expect(listJobs(db, ws)[0].state).toBe('done')
  })

  it('mesma chave de idempotência em outro workspace lança AppError', () => {
    const other = createWorkspace(db, { name: 'B', timeZone: 'UTC' }).id
    enqueue(db, { workspaceId: ws, type: 'export_tiktok', payload: {}, label: 'x', idempotencyKey: 'k' }, t0)
    expect(() => enqueue(db, { workspaceId: other, type: 'export_tiktok', payload: {}, label: 'x', idempotencyKey: 'k' }, t0))
      .toThrow(AppError)
  })

  it('duas conexões no mesmo arquivo: só uma recebe o job', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-queue-'))
    const file = join(dir, 'q.db')
    const a = openDb(file, MIGRATIONS_DIR)
    const b = openDb(file, MIGRATIONS_DIR)
    try {
      const w = createWorkspace(a.db, { name: 'A', timeZone: 'UTC' }).id
      enqueue(a.db, { workspaceId: w, type: 'make_thumbnail', payload: {}, label: 'x' }, t0)
      const results = [leaseNext(b.db, t0, 30_000), leaseNext(a.db, t0, 30_000)]
      expect(results.filter(Boolean)).toHaveLength(1)
      expect(() => enqueue(a.db, { workspaceId: w, type: 'make_thumbnail', payload: {}, label: 'y' }, t0)).not.toThrow()
    } finally {
      a.close(); b.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

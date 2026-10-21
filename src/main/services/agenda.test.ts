import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { containersInRange } from '../repos/publication-containers'
import { createContainer, scheduleContainer, cancelContainer, readContainer } from './publication-containers'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { readAgenda } from './agenda'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'
import { releaseAll } from './media-host/registry'

const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
let ctx: Ctx, ws: string, root: string, revA: string, revB: string, n = 0
const now = new Date('2026-10-12T12:00:00.000Z')
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legacy-agenda-'))
  ctx = { db: memDb(), dataRoot: root, clock: () => now }
  ws = createWorkspace(ctx.db, { name: 'Agenda', timeZone: 'America/Sao_Paulo' }).id
  ctx.secret = (w, k) => decryptSecret(ctx, vault, w, k)
  revA = (await connectInstagram(ctx, vault, ws, 'a', vi.fn().mockResolvedValue({ user_id: '111', id: '111', username: 'meme.a' }))).revision
  revB = (await connectInstagram(ctx, vault, ws, 'b', vi.fn().mockResolvedValue({ user_id: '222', id: '222', username: 'meme.b' }))).revision
})
afterEach(async () => { await releaseAll(); rmSync(root, { recursive: true, force: true }) })
function asset() { const id = `v-${++n}`, file = join(root, `${id}.mp4`); writeFileSync(file, id); return insertAsset(ctx.db, { id, workspaceId: ws, origin: 'pc', sourceName: `${id}.mp4`, filePath: file, sha256: `sha-${id}`, sizeBytes: 9, durationMs: 2000, width: 720, height: 1280, videoCodec: 'h264', validationJson: '{}', importedAt: now.toISOString() }).id }
function container(name: string, start: string | null, count = 12, account: '111' | '222' = '111', schedule = true) {
  const d = createContainer(ctx, ws, randomUUID(), { name, provider: 'instagram', destinationAccountId: account, accountRevision: account === '111' ? revA : revB, plannedStartAt: start, intervalMin: 15, items: Array.from({ length: count }, () => ({ assetId: asset() })) })
  if (schedule && start) scheduleContainer(ctx, ws, d.container.id, d.container.revision)
  return d.container.id
}
// The week of 2026-10-11 (Sunday) in São Paulo: [03:00Z Sunday, 03:00Z next Sunday).
const week = { from: '2026-10-11T03:00:00.000Z', to: '2026-10-18T03:00:00.000Z' }

it('one entry per Container in the range, with account, progress, estimate and drafts already positioned', () => {
  const meme = container('Meme', '2026-10-14T16:00:00.000Z')
  const draft = container('Rascunho posicionado', '2026-10-15T12:00:00.000Z', 4, '111', false)
  container('Sem horário', null, 2, '111', false)
  container('Semana seguinte', '2026-10-19T12:00:00.000Z')
  const r = readAgenda(ctx, ws, week)
  expect(r.timeZone).toBe('America/Sao_Paulo')
  expect(r.items.map(i => [i.name, i.state, i.username])).toEqual([['Meme', 'scheduled', 'meme.a'], ['Rascunho posicionado', 'draft', 'meme.a']])
  expect(r.items[0]).toMatchObject({ id: meme, plannedStartAt: '2026-10-14T16:00:00.000Z', plannedEndAt: '2026-10-14T18:45:00.000Z', counts: { total: 12, confirmed: 0 }, estimatedEndAt: '2026-10-14T18:45:00.000Z', delayMin: 0 })
  expect(r.items[1]).toMatchObject({ id: draft, estimatedEndAt: null })
})

it('a window crossing the range boundary is included; cancelled Containers are not; account filter isolates', async () => {
  container('Cruza o sábado', '2026-10-18T02:00:00.000Z', 8) // 23:00 Saturday local → 00:45 Sunday, past the range end
  const gone = container('Cancelado', '2026-10-13T12:00:00.000Z')
  await cancelContainer(ctx, ws, gone, readContainer(ctx, ws, gone).container.revision)
  container('Conta B', '2026-10-13T15:00:00.000Z', 3, '222')
  expect(readAgenda(ctx, ws, week).items.map(i => i.name)).toEqual(['Conta B', 'Cruza o sábado'])
  expect(readAgenda(ctx, ws, { ...week, accountId: '222' }).items.map(i => i.name)).toEqual(['Conta B'])
})

it('bounded and workspace-scoped; the IPC refuses inverted or oversized ranges', async () => {
  for (let i = 0; i < 3; i++) container(`C${i}`, `2026-10-1${3 + i}T12:00:00.000Z`, 1)
  expect(containersInRange(ctx.db, ws, now, { ...week, limit: 2 })).toMatchObject({ truncated: true, items: [{ name: 'C0' }, { name: 'C1' }] })
  const other = createWorkspace(ctx.db, { name: 'Outro', timeZone: 'UTC' }).id
  expect(readAgenda(ctx, ws, week).items).toHaveLength(3)
  expect(readAgenda(ctx, other, week).items).toHaveLength(0)
  const dispatch = createDispatcher(buildHandlers({ ctx, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null }, shell: { openPath: async () => '' }, workerAlive: () => false, version: 't', onJobsChanged: () => {} }))
  expect(await dispatch('agenda.range', { workspaceId: ws, from: week.to, to: week.from })).toMatchObject({ ok: false })
  expect(await dispatch('agenda.range', { workspaceId: ws, from: '2026-10-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' })).toMatchObject({ ok: false })
  expect(await dispatch('agenda.range', { workspaceId: ws, ...week })).toMatchObject({ ok: true, data: { truncated: false } })
})

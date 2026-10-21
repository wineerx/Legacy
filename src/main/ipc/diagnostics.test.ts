import { expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { enqueue } from '../queue/queue'
import { buildHandlers } from './handlers'
import { recordDiagnostic, rememberDiagnosticSecret } from '../diagnostics'

function setup() {
  const ctx = { db: memDb(), dataRoot: 'unused', clock: () => new Date('2026-10-07T14:00:00Z') }
  const ws = createWorkspace(ctx.db, { name: 'Teste', timeZone: 'UTC' }).id
  const file = join(mkdtempSync(join(tmpdir(), 'legacy-diag-export-')), 'diagnostics.json')
  const handlers = buildHandlers({ ctx, workerAlive: () => true, version: 'test', onJobsChanged() {}, shell: { openPath: async () => '' }, dialogs: { pickVideos: async () => [], pickImage: async () => null, pickMetricsFile: async () => null, saveDiagnostic: async () => file } })
  return { ctx, ws, file, handlers }
}
it('rejeita diagnóstico de workspace inexistente', async () => {
  const { handlers } = setup()
  expect(() => handlers['diagnostics.snapshot']({ workspaceId: 'missing' })).toThrow('Workspace não encontrado')
  await expect(handlers['diagnostics.export']({ workspaceId: 'missing' })).rejects.toThrow('Workspace não encontrado')
})
it('sanitiza fila e exporta todas as páginas sem limitar aos primeiros 100 eventos/jobs', async () => {
  const { ctx, ws, file, handlers } = setup()
  const secret = 'private-secret-never-visible'
  rememberDiagnosticSecret(secret)
  for (let i = 0; i < 105; i++) {
    enqueue(ctx.db, { workspaceId: ws, type: 'make_thumbnail', payload: { token: secret }, label: `Job ${i} ${secret}` }, ctx.clock())
    recordDiagnostic({ workspaceId: ws, source: 'test', level: 'ERROR', message: `Erro ${i} ${secret}`, metadata: { password: secret } })
  }
  const queue = await handlers['diagnostics.queue']({ workspaceId: ws, page: 1 })
  expect(queue.total).toBe(105)
  expect(JSON.stringify(queue)).not.toContain(secret)
  expect(await handlers['diagnostics.export']({ workspaceId: ws })).toEqual({ saved: true })
  const raw = readFileSync(file, 'utf8')
  const exported = JSON.parse(raw)
  expect(exported.queue.items).toHaveLength(105)
  expect(exported.events).toHaveLength(105)
  expect(raw).not.toContain(secret)
  expect(raw).not.toContain('payload')
})

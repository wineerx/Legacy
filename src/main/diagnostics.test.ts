import { expect, it } from 'vitest'
import { diagnosticEvents, diagnosticScope, recordDiagnostic, rememberDiagnosticSecret } from './diagnostics'
it('propaga tarefa e workspace entre operações assíncronas e mascara credenciais literais', async () => {
  rememberDiagnosticSecret('a-very-private-credential')
  await diagnosticScope.run({ workspaceId: 'diag-test', taskId: 'task-42', attempt: 2 }, async () => {
    await Promise.resolve()
    recordDiagnostic({ level: 'ERROR', source: 'worker', message: 'Erro a-very-private-credential', metadata: { stack: 'a-very-private-credential', authorization: 'private' } })
  })
  const events = diagnosticEvents('diag-test')
  expect(events.at(-1)).toMatchObject({ taskId: 'task-42', attempt: 2 })
  expect(JSON.stringify(events)).not.toContain('a-very-private-credential')
  expect(diagnosticEvents('another-workspace')).toEqual([])
})
it('mantém todos os eventos exportáveis até o limite de retenção', () => {
  for (let i = 0; i < 2100; i++) recordDiagnostic({ workspaceId: 'bounded', level: 'DEBUG', source: 'test', message: String(i) })
  expect(diagnosticEvents('bounded')).toHaveLength(2000)
  expect(diagnosticEvents('bounded')[0].message).toBe('100')
})

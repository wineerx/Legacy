import { describe, expect, it } from 'vitest'
import { groupEvents, sanitize, type DiagnosticEvent } from './diagnostics'
const event = (id: string, message = 'timeout'): DiagnosticEvent => ({ id, timestamp: `2026-10-07T14:00:0${id}Z`, source: 'network', provider: 'Instagram', level: 'ERROR', message, taskId: id, attempt: Number(id) })
describe('diagnósticos seguros', () => {
  it('mascara segredos aninhados, URLs e erros sem destruir IDs úteis', () => {
    const output = JSON.stringify(sanitize({ requestId: 'req-1', taskId: 'job-1', headers: { Authorization: 'Bearer private', Cookie: 'session=private' }, metadata: { password: 'private', api_key: 'private', nested: [{ accessToken: 'private' }] }, stack: 'Error token=private https://api.example/x?secret=private&task=job-1\nAuthorization: Bearer private' }))
    expect(output).not.toContain('private')
    expect(output).toContain('job-1')
    expect(output).toContain('req-1')
  })
  it('agrupa apenas duplicatas consecutivas e preserva tentativas e tarefas', () => {
    const groups = groupEvents([event('1'), event('2'), event('3', 'outro'), event('4')])
    expect(groups).toHaveLength(3)
    expect(groups[0].occurrences.map(e => e.taskId)).toEqual(['1', '2'])
    expect(groups[0].occurrences[1].attempt).toBe(2)
  })
})

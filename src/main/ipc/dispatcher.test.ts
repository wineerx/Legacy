import { describe, it, expect } from 'vitest'
import { createDispatcher } from './dispatcher'
import { AppError } from '@shared/errors'

const WS = '3f2b8c1e-8d2a-4b7e-9c11-2a6b5e4d7f10'

describe('createDispatcher', () => {
  const handlers = new Proxy({}, {
    get: (_t, key) => {
      if (key === 'jobs.list') return async (i: { workspaceId: string }) => [i.workspaceId]
      if (key === 'jobs.cancel') return () => { throw new AppError('not_found', 'Tarefa não encontrada.') }
      if (key === 'notifications.markRead') return () => { const e = new Error('x'); e.name = 'PathEscapeError'; throw e }
      if (key === 'jobs.retry') return () => { throw new Error('segredo interno') }
      return undefined
    }
  }) as never
  const dispatch = createDispatcher(handlers)

  it('valida e executa', async () => {
    expect(await dispatch('jobs.list', { workspaceId: WS })).toEqual({ ok: true, data: [WS] })
  })
  it('canal desconhecido', async () => {
    expect(await dispatch('fs.readAll', {})).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
  it('entrada inválida', async () => {
    expect(await dispatch('jobs.list', { workspaceId: '../x' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
  it('PathEscapeError vira invalid_input', async () => {
    expect(await dispatch('notifications.markRead', { workspaceId: WS, id: 'x' })).toEqual({ ok: false, error: { code: 'invalid_input', message: 'Caminho fora da pasta permitida.' } })
  })
  it('AppError vira payload; erro genérico não vaza mensagem', async () => {
    expect(await dispatch('jobs.cancel', { workspaceId: WS, id: 'x' })).toEqual({ ok: false, error: { code: 'not_found', message: 'Tarefa não encontrada.' } })
    const r = await dispatch('jobs.retry', { workspaceId: WS, id: 'x' })
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(JSON.stringify(r)).not.toContain('segredo')
  })
})

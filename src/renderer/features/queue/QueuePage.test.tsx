import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { QueuePage } from './QueuePage'

const job = (over: object) => ({ id: 'j1', workspaceId: WS_ID, type: 'export_tiktok', state: 'queued', attempts: 0, maxAttempts: 5, runAt: '2026-10-05T12:00:00.000Z', lastError: null, label: 'Exportar 2 vídeo(s) para TikTok', createdAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z', ...over })

describe('QueuePage', () => {
  it('lista com rótulos e cancela job na fila', async () => {
    const invoke = mockBridge({
      'jobs.list': () => [job({}), job({ id: 'j2', state: 'failed', attempts: 5, lastError: 'Processamento falhou (código 1)' })],
      'jobs.cancel': () => true, 'jobs.retry': () => true
    })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    await screen.findAllByText('Exportar 2 vídeo(s) para TikTok')
    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('Na fila')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Falhou')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Processamento falhou (código 1)')).toBeInTheDocument()
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Cancelar' }))
    expect(invoke).toHaveBeenCalledWith('jobs.cancel', { workspaceId: WS_ID, id: 'j1' })
    await userEvent.click(within(rows[2]).getByRole('button', { name: 'Tentar de novo' }))
    expect(invoke).toHaveBeenCalledWith('jobs.retry', { workspaceId: WS_ID, id: 'j2' })
  })

  it('estado vazio', async () => {
    mockBridge({ 'jobs.list': () => [] })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Nada na fila' })).toBeInTheDocument()
  })

  it('falha ao cancelar mostra toast de erro', async () => {
    mockBridge({ 'jobs.list': () => [job({})], 'jobs.cancel': () => { throw { code: 'internal', message: 'Job já iniciou.' } } })
    renderWithApp(<QueuePage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível cancelar')
    expect(alert).toHaveTextContent('Job já iniciou.')
  })
})

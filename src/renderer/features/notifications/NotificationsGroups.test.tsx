import { expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp } from '../../test-utils'
import { NotificationsPage } from './NotificationsPage'
it('lote recolhido expande e filtra publicações', async () => {
  mockBridge({ 'notifications.list': () => [1, 2].map(i => ({ id: String(i), kind: 'info', title: `Vídeo ${i} baixado`, body: 'Concluído', actionJson: JSON.stringify({ type: 'open_queue', jobId: String(i), groupId: 'batch', category: 'download' }), dueAt: null, readAt: null, createdAt: '2026-10-05T12:00:00Z' })) })
  const navigate = vi.fn(); renderWithApp(<NotificationsPage navigate={navigate} />)
  const summary = await screen.findByText('Downloads · 2 eventos · 2 não lidas')
  await userEvent.click(summary)
  expect(screen.getByText('Vídeo 1 baixado')).toBeVisible()
  await userEvent.click(screen.getAllByRole('button', { name: 'Ver na fila' })[0]); expect(navigate).toHaveBeenCalledWith('queue')
  await userEvent.click(screen.getByRole('button', { name: 'Publicações' }))
  expect(screen.getByText('Nenhuma notificação neste filtro.')).toBeVisible()
})

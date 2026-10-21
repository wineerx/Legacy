import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContainerDetail } from '@shared/publication-containers'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { detail } from '../library/container-draft.fixtures'
import { AgendaSheet } from './AgendaSheet'

const ID = '705e4d11-07c3-424a-8dce-7b3107f030f9'
function scheduled(state: ContainerDetail['container']['state'] = 'in_progress', total = 45): ContainerDetail {
  const base = detail(['a', 'b'])
  return { ...base, total, page: 1, pageSize: 20,
    container: { ...base.container, id: ID, name: 'Container #25', provider: 'instagram', destinationAccountId: '111', state, revision: 3, scheduledAt: '2026-10-12T15:00:00.000Z', controlState: state === 'paused' ? 'paused' : 'active',
      plannedStartAt: '2026-10-12T16:00:00.000Z', plannedEndAt: '2026-10-12T18:45:00.000Z', estimatedEndAt: '2026-10-12T19:07:00.000Z', delayMin: 22,
      counts: { total, confirmed: 7, pending: 36, running: 1, failed: 1, cancelled: 0, terminal: 8, started: 9, remoteOpen: 1, waitingQuota: 2 } },
    items: base.items.map((i, k) => ({ ...i, jobId: `j${k}`, jobState: k ? 'queued' : 'done', confirmed: !k, plannedPublishAt: '2026-10-12T16:00:00.000Z' })) }
}

describe('AgendaSheet', () => {
  it('shows totals of the whole Container (not the page), window, delay, quota wait and paginated items', async () => {
    const invoke = mockBridge({ 'containers.get': ({ page }) => ({ ...scheduled(), page }) })
    renderWithApp(<AgendaSheet workspaceId={WS_ID} containerId={ID} username="365spiders" onClose={() => {}} onEdit={() => {}} />)
    expect(await screen.findByRole('dialog', { name: 'Container #25' })).toHaveTextContent('Instagram · @365spiders')
    expect(screen.getByText('7 / 45')).toBeInTheDocument()
    expect(screen.getByText('36 na fila · 1 enviando · 1 com falha · 0 cancelado(s)')).toBeInTheDocument()
    expect(screen.getByText('+22 min')).toBeInTheDocument()
    expect(screen.getByText('2 aguardando quota')).toBeInTheDocument()
    expect(screen.getByText('12/10, 13:00')).toBeInTheDocument()
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.get', { workspaceId: WS_ID, containerId: ID, page: 2, pageSize: 20 }))
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('pause and resume send the Container revision; reschedule opens the window adjustments', async () => {
    let state: 'in_progress' | 'paused' = 'in_progress'
    const invoke = mockBridge({ 'containers.get': () => scheduled(state), 'containers.pause': () => { state = 'paused'; return scheduled('paused') }, 'containers.resume': () => { state = 'in_progress'; return scheduled() },
      'containers.window.get': () => ({ containerId: ID, revision: 3, timeZone: 'America/Sao_Paulo', window: { status: 'on_time', plannedStartAt: null, plannedEndAt: null, intervalMin: 15, estimatedEndAt: null, delayMin: 0, published: 7, remaining: 38, inFlight: 0, failed: 0, overdue: 0, quotaConsidered: false, estimate: [] }, proposals: { proposals: [], unavailable: [] }, quota: { total: null, available: null, fetchedAt: null, freshness: 'missing' }, adjustments: [] }) })
    renderWithApp(<AgendaSheet workspaceId={WS_ID} containerId={ID} username={null} onClose={() => {}} onEdit={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Pausar' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.pause', { workspaceId: WS_ID, containerId: ID, expectedRevision: 3 }))
    await userEvent.click(await screen.findByRole('button', { name: 'Retomar' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('containers.resume', { workspaceId: WS_ID, containerId: ID, expectedRevision: 3 }))
    await userEvent.click(await screen.findByRole('button', { name: 'Reagendar' }))
    expect(await screen.findByRole('region', { name: 'Janela do Container' })).toBeInTheDocument()
  })

  it('a draft offers Edit; finished Containers offer no agenda action', async () => {
    const onEdit = vi.fn()
    let current: ContainerDetail = { ...detail(['a']), container: { ...detail(['a']).container, id: ID, name: 'Rascunho', plannedStartAt: '2026-10-12T16:00:00.000Z' } }
    mockBridge({ 'containers.get': () => current })
    const view = renderWithApp(<AgendaSheet workspaceId={WS_ID} containerId={ID} username={null} onClose={() => {}} onEdit={onEdit} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(onEdit).toHaveBeenCalledWith(ID)
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull()
    view.unmount()
    current = scheduled('completed')
    renderWithApp(<AgendaSheet workspaceId={WS_ID} containerId={ID} username={null} onClose={() => {}} onEdit={onEdit} />)
    expect(await screen.findByText('Container concluído: sem ações de agenda.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reagendar' })).toBeNull()
  })
})

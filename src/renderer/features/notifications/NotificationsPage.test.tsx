import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { NotificationsPage } from './NotificationsPage'

const note = (over: object) => ({ id: 'n1', workspaceId: WS_ID, kind: 'info', title: 'Exportação pronta', body: 'Lote 1', dueAt: null, readAt: null, actionJson: null, createdAt: '2026-10-05T12:00:00.000Z', ...over })

describe('NotificationsPage', () => {
  it('open_folder chama export.openFolder e marca como lida', async () => {
    const path = 'C:\dados\exports\lote1'
    const invoke = mockBridge({ 'notifications.list': () => [note({ actionJson: JSON.stringify({ type: 'open_folder', path }) })], 'notifications.markRead': () => null, 'export.openFolder': () => null })
    renderWithApp(<NotificationsPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir pasta' }))
    expect(invoke).toHaveBeenCalledWith('export.openFolder', { workspaceId: WS_ID, path })
    expect(invoke).toHaveBeenCalledWith('notifications.markRead', { workspaceId: WS_ID, id: 'n1' })
  })

  it('open_queue navega para a fila', async () => {
    const navigate = vi.fn()
    mockBridge({ 'notifications.list': () => [note({ actionJson: JSON.stringify({ type: 'open_queue', jobId: 'j1' }) })], 'notifications.markRead': () => null })
    renderWithApp(<NotificationsPage navigate={navigate} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ver na fila' }))
    expect(navigate).toHaveBeenCalledWith('queue')
  })

  it('actionJson malformado não quebra e não mostra ação', async () => {
    mockBridge({ 'notifications.list': () => [note({ actionJson: '{nao-json' })] })
    renderWithApp(<NotificationsPage navigate={vi.fn()} />)
    expect(await screen.findByText('Exportação pronta')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir pasta' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ver na fila' })).toBeNull()
  })

  it('falha ao abrir pasta mostra toast de erro', async () => {
    mockBridge({ 'notifications.list': () => [note({ actionJson: JSON.stringify({ type: 'open_folder', path: 'x' }) })], 'notifications.markRead': () => null, 'export.openFolder': () => { throw { code: 'invalid_input', message: 'Pasta inválida.' } } })
    renderWithApp(<NotificationsPage navigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir pasta' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível abrir a pasta')
    expect(alert).toHaveTextContent('Pasta inválida.')
  })
})

it('seleção múltipla e exclusão em massa aguardam confirmação', async () => {
  const invoke = mockBridge({'notifications.list':()=>[note({}),note({id:'n2',title:'Outra'})], 'notifications.delete':()=>({deleted:2})})
  renderWithApp(<NotificationsPage navigate={vi.fn()}/>)
  await screen.findByText('Outra')
  await userEvent.click(screen.getByRole('button',{name:'Selecionar notificações'}))
  await userEvent.click(screen.getByRole('checkbox',{name:'Selecionar todas'}))
  await userEvent.click(screen.getByRole('button',{name:'Excluir selecionadas (2)'}))
  expect(invoke.mock.calls.some(c=>c[0]==='notifications.delete')).toBe(false)
  await userEvent.click(screen.getByRole('button',{name:'Confirmar exclusão'}))
  expect(invoke).toHaveBeenCalledWith('notifications.delete',{workspaceId:WS_ID,ids:['n1','n2']})
})

it('selecionar todas fica desativado quando o filtro não contém notificações', async () => {
 mockBridge({'notifications.list':()=>[]})
 renderWithApp(<NotificationsPage navigate={vi.fn()}/>)
 await screen.findByText('Tudo em dia')
 await userEvent.click(screen.getByRole('button',{name:'Selecionar notificações'}))
 const input=screen.getByRole('checkbox',{name:'Selecionar todas'})
 expect(input).toBeDisabled()
 expect(input.closest('label')).toHaveClass('ds-choice-compact')
 await userEvent.click(input)
 expect(input).not.toBeChecked()
 expect(screen.getByRole('button',{name:'Excluir selecionadas (0)'})).toBeDisabled()
})

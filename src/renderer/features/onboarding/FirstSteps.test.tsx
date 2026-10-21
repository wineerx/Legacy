import { expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirstSteps } from './FirstSteps'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'

const items = [{ key: 'profile', label: 'Adicionar primeiro perfil', done: true }, { key: 'schedule', label: 'Criar primeiro agendamento', done: false }]

it('shows real circular progress, highlights the next task and navigates', async () => {
  const navigate = vi.fn()
  mockBridge({ 'onboarding.status': () => items })
  renderWithApp(<FirstSteps navigate={navigate} />)
  expect(await screen.findByText('1 de 2 concluídos')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '2')
  const next = screen.getByRole('button', { name: /Criar primeiro agendamento/ })
  expect(next).toHaveAttribute('data-next', 'true')
  await userEvent.click(next)
  expect(navigate).toHaveBeenCalledWith('profiles')
})

it('closes and reopens locally without a permanent dismissal action', async () => {
  const invoke = mockBridge({ 'onboarding.status': () => items })
  renderWithApp(<FirstSteps navigate={vi.fn()} />)
  await screen.findByText('1 de 2 concluídos')
  expect(screen.queryByRole('button', { name: 'Dispensar permanentemente' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Fechar primeiros passos' }))
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Mostrar primeiros passos' }))
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  expect(invoke).not.toHaveBeenCalledWith('settings.set', expect.anything())
})

it('can restore a previously saved hidden preference', async () => {
  const invoke = mockBridge({ 'onboarding.status': () => items, 'settings.get': () => 'true', 'settings.set': () => null })
  renderWithApp(<FirstSteps navigate={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Mostrar primeiros passos' }))
  await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument())
  expect(invoke).toHaveBeenCalledWith('settings.set', { workspaceId: WS_ID, key: 'onboardingDismissed', value: 'false' })
})

it('keeps the guide closed when the sidebar collapses and expands', async () => {
  mockBridge({ 'onboarding.status': () => items })
  const navigate = vi.fn()
  const view = renderWithApp(<FirstSteps navigate={navigate} />)
  await screen.findByText('1 de 2 concluídos')
  view.rerender(<FirstSteps navigate={navigate} collapsed />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  view.rerender(<FirstSteps navigate={navigate} collapsed={false} />)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Mostrar primeiros passos' }))
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
})

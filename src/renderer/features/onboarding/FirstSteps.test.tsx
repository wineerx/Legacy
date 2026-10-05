import { expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirstSteps } from './FirstSteps'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
it('shows real progress, navigates and only allows dismissal after completion', async () => {
  let hidden = false
  const navigate = vi.fn()
  const invoke = mockBridge({ 'onboarding.status': () => [{ key: 'profile', label: 'Adicionar primeiro perfil', done: true }, { key: 'schedule', label: 'Criar primeiro agendamento', done: false }], 'settings.get': () => hidden ? 'true' : null, 'settings.set': () => { hidden = true; return null } })
  renderWithApp(<FirstSteps navigate={navigate} />)
  expect(await screen.findByText('1 de 2')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1')
  expect(screen.queryByText('Recolher checklist')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Criar primeiro agendamento/ }))
  expect(navigate).toHaveBeenCalledWith('profiles')
  expect(invoke).not.toHaveBeenCalledWith('settings.set', { workspaceId: WS_ID, key: 'onboardingDismissed', value: 'true' })
})

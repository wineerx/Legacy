import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../test-utils'
import { AccountSwitcher } from './AccountSwitcher'

const acc = (id: string, username: string) => ({ id, username, revision: 'r', validatedAt: '2026-10-18T00:00:00Z' })
describe('AccountSwitcher', () => {
  it('shows the active account, marks it, switches on click and offers adding an account', async () => {
    let active = acc('1', 'tobybelhome')
    const invoke = mockBridge({ 'accounts.instagramList': () => [acc('1', 'tobybelhome'), acc('2', 'acmestudio')], 'accounts.instagram': () => active,
      'accounts.setDefault': ({ accountId }) => { active = accountId === '2' ? acc('2', 'acmestudio') : acc('1', 'tobybelhome'); return active } })
    const navigate = vi.fn()
    renderWithApp(<AccountSwitcher collapsed={false} onNavigate={navigate} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Conta ativa: @tobybelhome. Trocar conta' }))
    const list = await screen.findByRole('list', { name: 'Contas conectadas' })
    expect(within(list).getByRole('button', { name: '@tobybelhome, conta ativa' })).toHaveAttribute('aria-current', 'true')
    await userEvent.click(within(list).getByRole('button', { name: '@acmestudio' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('accounts.setDefault', { workspaceId: WS_ID, accountId: '2' }))
    expect(await screen.findByRole('button', { name: 'Conta ativa: @acmestudio. Trocar conta' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Conta ativa: @acmestudio. Trocar conta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar conta' }))
    expect(navigate).toHaveBeenCalledWith('accounts')
  })

  it('without accounts it invites to connect one', async () => {
    mockBridge({ 'accounts.instagramList': () => [], 'accounts.instagram': () => null })
    renderWithApp(<AccountSwitcher collapsed={false} onNavigate={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Selecionar conta' }))
    expect(await screen.findByText('Nenhuma conta conectada.')).toBeInTheDocument()
  })
})

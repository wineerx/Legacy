import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { App } from './App'
import { mockBridge, WS_ID } from './test-utils'

const WS2 = '7a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'

describe('App', () => {
  it('app.navigate com workspaceId troca de workspace', async () => {
    try { localStorage.clear() } catch { /* ok */ }
    mockBridge({
      'app.bootstrap': () => ({ workspaces: [{ id: WS_ID, name: 'Primeiro', timeZone: 'UTC' }, { id: WS2, name: 'Segundo', timeZone: 'UTC' }], version: 't', workerAlive: true, dataDir: 'x' }),
      'notifications.list': () => []
    })
    const handlers: Record<string, (p: unknown) => void> = {}
    window.legacy.on = vi.fn((name: string, cb: (p: unknown) => void) => { handlers[name] = cb; return () => {} }) as never
    render(<App />)
    await waitFor(() => expect(handlers['app.navigate']).toBeDefined())
    await act(async () => { handlers['app.navigate']({ page: 'notifications', workspaceId: WS2 }) })
    await waitFor(() => expect(localStorage.getItem('workspaceId')).toBe(WS2))
    expect(screen.queryByText('Abrindo…')).toBeNull()
  })
})

it('entrada impede app.navigate de contornar a sessão e permite entrar depois', async () => {
  localStorage.clear()
  const invoke = mockBridge({ 'session.get': () => ({ entered: false, email: 'guest@legacy.com', mode: 'development' }), 'notifications.list': () => [] })
  const handlers: ((p: unknown) => void)[] = []
  window.legacy.on = vi.fn((name, cb) => { if (name === 'app.navigate') handlers.push(cb); return () => {} }) as never
  render(<App />)
  await screen.findByRole('button', { name: 'Entrar como visitante' })
  await act(async () => handlers.forEach(h => h({ page: 'notifications', workspaceId: WS_ID })))
  expect(screen.getByRole('heading', { name: 'Entrar no Legacy' })).toBeVisible()
  expect(invoke.mock.calls.some(([channel]) => channel === 'dashboard.get')).toBe(false)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Entrar como visitante' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: 'Entrar como visitante' }))
  await screen.findByRole('heading', { name: 'Notificações' })
})

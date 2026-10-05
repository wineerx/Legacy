import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
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

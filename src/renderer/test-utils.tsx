import { vi } from 'vitest'
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Channel } from '@shared/ipc-contract'
import { ToastProvider } from './components/ui'
import { WorkspaceProvider } from './lib/workspace'

export const WS_ID = '3f2b8c1e-8d2a-4b7e-9c11-2a6b5e4d7f10'

export function mockBridge(handlers: Partial<Record<Channel, (input: any) => unknown>>) {
  const all: Partial<Record<Channel, (input: any) => unknown>> = {
    'app.bootstrap': () => ({ workspaces: [{ id: WS_ID, name: 'Meu workspace', timeZone: 'America/Sao_Paulo' }], version: 't', workerAlive: true, dataDir: 'C:\\Users\\teste\\AppData\\Roaming\\Legacy' }),
    ...handlers
  }
  const invoke = vi.fn(async (channel: Channel, input: unknown) => {
    const h = all[channel]
    if (!h) return { ok: false, error: { code: 'internal', message: `sem mock para ${channel}` } }
    try { return { ok: true, data: await h(input) } } catch (e) { return { ok: false, error: e as { code: string; message: string } } }
  })
  window.legacy = { invoke, on: () => () => {}, pathForFile: (f: File) => `C:\\fake\\${f.name}`, version: 't' }
  return invoke
}

export function renderWithApp(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ToastProvider><WorkspaceProvider>{ui}</WorkspaceProvider></ToastProvider></QueryClientProvider>)
}

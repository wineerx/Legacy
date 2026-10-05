import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobView } from '@shared/types'
import { MascotProvider, SLEEP_AFTER_MS, useMascot, useMascotSignal } from './MascotProvider'
import { beginActivity } from './activity'

vi.mock('../../lib/workspace', () => ({ useWorkspace: () => ({ workspace: { id: 'ws' }, workerAlive: true }) }))
vi.mock('../../lib/api', () => ({ call: vi.fn(async (channel: string) => channel === 'jobs.list' ? [] : []), onEvent: () => () => {} }))
const job = (state: JobView['state']): JobView => ({ id: 'j', workspaceId: 'ws', type: 'download_reel', state, label: 'Baixando vídeo', attempts: 1, maxAttempts: 5, runAt: new Date(0).toISOString(), lastError: null, createdAt: '', updatedAt: state })
function Probe({ approval = false }: { approval?: boolean }) {
  const mascot = useMascot()
  useMascotSignal(approval, 'approval', 'Revise o lote.')
  return <><output data-testid="state">{mascot.state}</output><span>{mascot.message}</span><button onClick={mascot.react}>Reagir</button></>
}
function setup(jobs: JobView[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } })
  client.setQueryData(['jobs', 'ws'], jobs)
  client.setQueryData(['notifications', 'ws'], [])
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><MascotProvider>{children}</MascotProvider></QueryClientProvider>
  const view = render(<Probe />, { wrapper })
  return { client, ...view }
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('Controlador do mascote', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())
  it('não comemora histórico e volta ao repouso após uma conclusão nova', async () => {
    const { client } = setup([job('done')])
    await advance(1100)
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
    act(() => client.setQueryData(['jobs', 'ws'], [job('running')]))
    await advance(5)
    expect(screen.getByTestId('state')).toHaveTextContent('downloading')
    act(() => client.setQueryData(['jobs', 'ws'], [job('done')]))
    await advance(5)
    expect(screen.getByTestId('state')).toHaveTextContent('finished')
    await advance(651)
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })
  it('mantém operações concorrentes e limpa cancelamentos e pedidos de aprovação', async () => {
    const view = setup()
    await advance(1100)
    let first!: ReturnType<typeof beginActivity>, second!: ReturnType<typeof beginActivity>
    act(() => { first = beginActivity('profiles.importMetricsFile', 'ws'); second = beginActivity('library.importPaths', 'ws') })
    await advance(181)
    expect(screen.getByTestId('state')).toHaveTextContent('working')
    act(() => second('cancelled'))
    expect(screen.getByTestId('state')).toHaveTextContent('thinking')
    view.rerender(<Probe approval />)
    expect(screen.getByTestId('state')).toHaveTextContent('approval')
    view.rerender(<Probe />)
    act(() => first('cancelled'))
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })
  it('não recebe operações de outro workspace e respeita cooldown', async () => {
    setup()
    await advance(1100)
    const end = beginActivity('library.importPaths', 'outro')
    await advance(181)
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
    act(() => end('error', 'Erro em outro workspace'))
    fireEvent.click(screen.getByText('Reagir'))
    expect(screen.getByTestId('state')).toHaveTextContent('greeting')
    await advance(1000)
    fireEvent.click(screen.getByText('Reagir'))
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
    await advance(6100)
    fireEvent.click(screen.getByText('Reagir'))
    expect(screen.getByTestId('state')).toHaveTextContent('wink')
  })
  it('descansa por inatividade e acorda com interação real', async () => {
    setup()
    await advance(SLEEP_AFTER_MS + 1)
    expect(screen.getByTestId('state')).toHaveTextContent('sleeping')
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5 })
    expect(screen.getByTestId('state')).toHaveTextContent('greeting')
    await advance(1000)
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })
  it('reage apenas a notificações novas e mantém erros acima da interação', async () => {
    const { client } = setup()
    await advance(1100)
    act(() => client.setQueryData(['notifications', 'ws'], [{ id: 'novo', readAt: null }]))
    await advance(5)
    expect(screen.getByTestId('state')).toHaveTextContent('notification')
    await advance(901)
    act(() => client.setQueryData(['jobs', 'ws'], [{ ...job('failed'), lastError: 'Vídeo indisponível.' }]))
    await advance(5)
    fireEvent.click(screen.getByText('Reagir'))
    expect(screen.getByTestId('state')).toHaveTextContent('error')
    expect(screen.getByText(/Vídeo indisponível/)).toBeInTheDocument()
  })
})

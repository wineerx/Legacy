import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocked.fork } }))
import { startWorker } from './supervisor'
it('envia credenciais somente após receptor pronto e não encaminha handshake como evento de tarefa', async () => {
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
  mocked.fork.mockReturnValue(child)
  const onEvent = vi.fn()
  const worker = startWorker({ dbPath: 'db', dataRoot: 'data', migrationsDir: 'migrations', onEvent, credentials: () => ({ ws: { instagramToken: 'protected-test-token' } }) })
  child.emit('spawn'); expect(child.postMessage).not.toHaveBeenCalled()
  child.emit('message', { type: 'credentials-ready' })
  expect(child.postMessage).toHaveBeenCalledWith({ type: 'credentials', secrets: { ws: { instagramToken: 'protected-test-token' } } })
  expect(onEvent).not.toHaveBeenCalled()
  child.emit('message', { type: 'job-updated', jobId: '1' }); expect(onEvent).toHaveBeenCalledOnce()
  const stopped = worker.stop(); child.emit('exit'); await stopped
})

it('preserva pausa no reinício e não interrompe o processo em andamento', async () => {
  vi.useFakeTimers()
  const first = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
  const second = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
  mocked.fork.mockReturnValueOnce(first).mockReturnValueOnce(second)
  const worker = startWorker({ dbPath: 'db', dataRoot: 'data', migrationsDir: 'migrations', onEvent: vi.fn(), initiallyPaused: true })
  expect(mocked.fork.mock.calls.at(-1)?.[2].env.LEGACY_WORKER_PAUSED).toBe('1')
  worker.setPaused(false)
  expect(first.postMessage).toHaveBeenLastCalledWith({ type: 'pause', paused: false })
  worker.setPaused(true)
  expect(first.kill).not.toHaveBeenCalled()
  expect(first.postMessage).toHaveBeenLastCalledWith({ type: 'pause', paused: true })
  first.emit('exit')
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocked.fork.mock.calls.at(-1)?.[2].env.LEGACY_WORKER_PAUSED).toBe('1')
  second.emit('message', { type: 'credentials-ready' })
  expect(second.postMessage).toHaveBeenCalledWith({ type: 'pause', paused: true })
  const stopped = worker.stop(); second.emit('exit'); await stopped
  vi.useRealTimers()
})

import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  close: vi.fn(),
  release: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn()
}))
vi.mock('../db/client', () => ({
  openDb: () => ({ db: {}, close: mocks.close })
}))
vi.mock('../queue/queue', () => ({ recoverExpired: vi.fn() }))
vi.mock('./handlers', () => ({
  processNext: mocks.next,
  maybeRecover: (_ctx: unknown, last: number) => last
}))
vi.mock('../services/media-host/registry', () => ({
  beginShutdown: mocks.shutdown,
  releaseAll: mocks.release,
  releaseExpired: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../services/media-host/tunnel', () => ({ closeAllTunnels: vi.fn() }))
vi.mock('../services/publish-tmp', () => ({ sweepPublishTmp: vi.fn() }))

it('pausar durante uma publicação permite confirmação e impede a próxima tarefa até retomar', async () => {
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort')
  Object.defineProperty(process, 'parentPort', {
    configurable: true,
    value: port
  })
  vi.stubEnv('LEGACY_DB_PATH', 'test')
  vi.stubEnv('LEGACY_MIGRATIONS_DIR', 'test')
  vi.stubEnv('LEGACY_DATA_DIR', 'test')
  vi.stubEnv('LEGACY_MANAGED_SECRETS', '0')
  vi.stubEnv('LEGACY_WORKER_PAUSED', '0')
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never)
  let confirm!: () => void
  const published = vi.fn()
  mocks.next
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          confirm = () => {
            published()
            resolve(true)
          }
        })
    )
    .mockResolvedValue(false)
  try {
    await import('./worker')
    await vi.waitFor(() => expect(mocks.next).toHaveBeenCalledTimes(1))
    port.emit('message', { data: { type: 'pause', paused: true } })
    confirm()
    await vi.waitFor(() => expect(published).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(mocks.next).toHaveBeenCalledTimes(1)
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    port.emit('message', { data: { type: 'pause', paused: false } })
    await vi.waitFor(() => expect(mocks.next).toHaveBeenCalledTimes(2), {
      timeout: 1500
    })
    port.emit('message', { data: { type: 'stop' } })
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), {
      timeout: 1500
    })
  } finally {
    port.emit('message', { data: { type: 'stop' } })
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor)
    else Reflect.deleteProperty(process, 'parentPort')
    vi.unstubAllEnvs()
    exit.mockRestore()
  }
})

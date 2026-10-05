import { EventEmitter } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import { setupUpdates } from './updates'

function adapter() { return Object.assign(new EventEmitter(), { autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: true, checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }) }
describe('atualizador', () => {
  it('consulta sem baixar, baixa por ação e bloqueia reinício durante tarefa', async () => {
    const a = adapter(); let running = true; const before = vi.fn()
    const updates = setupUpdates(a, true, () => running, before)
    expect(a.autoDownload).toBe(false); expect(a.autoInstallOnAppQuit).toBe(false)
    a.checkForUpdates.mockImplementation(async () => { a.emit('update-available', { version: '0.4.0' }) })
    expect((await updates.check()).state).toBe('available'); expect(a.downloadUpdate).not.toHaveBeenCalled()
    a.downloadUpdate.mockImplementation(async () => { a.emit('update-downloaded', { version: '0.4.0' }) })
    expect((await updates.download()).state).toBe('downloaded')
    expect(() => updates.install()).toThrow(/tarefas em execução/)
    running = false; updates.install(); expect(before).toHaveBeenCalled(); expect(a.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
  it('falha de release não afirma que a versão é atual', async () => {
    const a = adapter(); a.checkForUpdates.mockRejectedValue(new Error('404'))
    const updates = setupUpdates(a, true, () => false, vi.fn())
    expect((await updates.check()).state).toBe('error'); expect(() => updates.install()).toThrow(/Baixe/)
  })
  it('desenvolvimento não consulta rede', async () => {
    const a = adapter(); expect((await setupUpdates(a, false, () => false, vi.fn()).check()).state).toBe('unsupported')
    expect(a.checkForUpdates).not.toHaveBeenCalled()
  })
})

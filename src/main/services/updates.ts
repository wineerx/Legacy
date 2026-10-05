import type { UpdateStatus } from '@shared/ipc-contract'
import { AppError } from '@shared/errors'

export interface UpdaterAdapter {
  autoDownload: boolean; autoInstallOnAppQuit: boolean; allowPrerelease: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>; downloadUpdate(): Promise<unknown>; quitAndInstall(silent?: boolean, restart?: boolean): void
}
export function setupUpdates(updater: UpdaterAdapter, packaged: boolean, hasRunningJobs: () => boolean, beforeInstall: () => void) {
  let status: UpdateStatus = { state: packaged ? 'idle' : 'unsupported', version: null, progress: 0, message: packaged ? 'Consulte as releases oficiais no GitHub.' : 'Verificação disponível no aplicativo instalado.' }
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.allowPrerelease = false
  const set = (next: Partial<UpdateStatus>) => { status = { ...status, ...next } }
  updater.on('update-available', (info: { version: string }) => set({ state: 'available', version: info.version, message: `Versão ${info.version} disponível.` }))
  updater.on('update-not-available', () => set({ state: 'current', version: null, message: 'Você está na versão mais recente publicada.' }))
  updater.on('download-progress', (info: { percent: number }) => set({ state: 'downloading', progress: Math.min(100, Math.max(0, info.percent)), message: 'Baixando atualização…' }))
  updater.on('update-downloaded', (info: { version: string }) => set({ state: 'downloaded', version: info.version, progress: 100, message: 'Atualização pronta. Instale e reinicie quando terminar suas tarefas.' }))
  updater.on('error', () => set({ state: 'error', message: 'Não foi possível consultar ou baixar a release. Verifique a conexão e se a release contém latest.yml e o instalador.' }))
  return {
    status: () => ({ ...status }),
    async check() {
      if (!packaged) return { ...status }
      if (['checking', 'downloading', 'downloaded'].includes(status.state)) return { ...status }
      set({ state: 'checking', progress: 0, message: 'Verificando releases do Legacy…' })
      try { await updater.checkForUpdates() } catch { set({ state: 'error', message: 'Sem release válida disponível ou conexão indisponível. Nenhuma atualização foi instalada.' }) }
      return { ...status }
    },
    async download() {
      if (status.state !== 'available') throw new AppError('invalid_input', 'Verifique uma nova versão antes de baixar.')
      set({ state: 'downloading', progress: 0, message: 'Baixando atualização…' })
      try { await updater.downloadUpdate() } catch { set({ state: 'error', message: 'Download não concluído. Tente verificar novamente.' }) }
      return { ...status }
    },
    install() {
      if (status.state !== 'downloaded') throw new AppError('invalid_input', 'Baixe a atualização antes de instalar.')
      if (hasRunningJobs()) throw new AppError('invalid_input', 'Aguarde as tarefas em execução antes de reiniciar.')
      beforeInstall(); updater.quitAndInstall(true, true)
    }
  }
}

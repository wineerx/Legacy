import { contextBridge, ipcRenderer, webUtils } from 'electron'

const ALLOWED_EVENTS = new Set(['jobs.changed', 'app.navigate', 'app.visibility'])

contextBridge.exposeInMainWorld('legacy', {
  version: process.env.LEGACY_APP_VERSION,
  invoke: (channel: string, input: unknown) => ipcRenderer.invoke('legacy:invoke', channel, input),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!ALLOWED_EVENTS.has(event)) throw new Error(`Evento não permitido: ${event}`)
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file)
})

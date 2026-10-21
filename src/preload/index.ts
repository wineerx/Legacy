import { contextBridge, ipcRenderer, webUtils } from 'electron'

const ALLOWED_EVENTS = new Set(['jobs.changed', 'app.navigate', 'app.visibility'])
declare const __LEGACY_PERF_DEBUG__: boolean
const perfDebug=typeof __LEGACY_PERF_DEBUG__!=='undefined' && __LEGACY_PERF_DEBUG__
const listenerCounts:Record<string,number>={}

contextBridge.exposeInMainWorld('legacy', {
  version: process.env.LEGACY_APP_VERSION,
  invoke: (channel: string, input: unknown) => ipcRenderer.invoke('legacy:invoke', channel, input),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!ALLOWED_EVENTS.has(event)) throw new Error(`Evento não permitido: ${event}`)
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(event, listener)
    if(perfDebug)listenerCounts[event]=(listenerCounts[event]??0)+1
    let disposed=false
    return () => {
      if(disposed)return
      disposed=true;ipcRenderer.removeListener(event,listener)
      if(perfDebug)listenerCounts[event]--
    }
  },
  ...(perfDebug?{debugListenerCounts:()=>({...listenerCounts})}:{}),
  pathForFile: (file: File) => webUtils.getPathForFile(file)
})

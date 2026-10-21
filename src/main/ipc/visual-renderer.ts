import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { visualLayout, type VisualLayout } from '@shared/visual-layout'
import type { RasterizeVisual, VisualRaster } from '@shared/visual-raster'

/** The minimum surface the queue needs; tests replace the Electron window with a fake. */
export interface VisualRendererHost {
  load(): Promise<void>
  run(layout: VisualLayout): Promise<VisualRaster>
  onGone(cb: (reason: string) => void): void
  destroy(): void
}

/** A dedicated sandboxed renderer, with no preload, Node, network or provider credentials. */
function electronHost(rendererDir: string): VisualRendererHost {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', e => e.preventDefault())
  return {
    load: () => process.env.ELECTRON_RENDERER_URL ? window.loadURL(new URL('visual-renderer.html', process.env.ELECTRON_RENDERER_URL).href) : window.loadFile(join(rendererDir, 'visual-renderer.html')),
    run: layout => window.webContents.executeJavaScript(`window.renderVisual(${JSON.stringify(layout)})`),
    onGone: cb => {
      window.webContents.on('render-process-gone', (_e, details) => cb(details.reason))
      window.webContents.on('unresponsive', () => cb('unresponsive'))
    },
    destroy: () => { if (!window.isDestroyed()) window.destroy() }
  }
}

/**
 * Renders one layout at a time. A crash, hang or failed load discards the hidden
 * window and rejects only the affected request; the next request starts a fresh one.
 * The worker treats the rejection as a transient failure, so leases and checkpoints stay intact.
 */
export function createVisualRenderer(opts: { rendererDir?: string; timeoutMs?: number; createHost?: () => VisualRendererHost } = {}) {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const createHost = opts.createHost ?? (() => electronHost(opts.rendererDir ?? join(import.meta.dirname, '../renderer')))
  let host: VisualRendererHost | null = null, ready: Promise<void> | null = null, queue = Promise.resolve(), stopped = false
  let abort: ((error: Error) => void) | null = null
  const discard = () => { const current = host; host = null; ready = null; current?.destroy() }
  const render: RasterizeVisual = layout => {
    const parsed = visualLayout.safeParse(layout)
    if (!parsed.success) return Promise.reject(parsed.error)
    const checked = parsed.data
    const action = queue.then(() => new Promise<VisualRaster>((resolve, reject) => {
      if (stopped) return reject(new Error('Renderizador encerrado.'))
      let settled = false
      const finish = (error: Error | null, value?: VisualRaster) => {
        if (settled) return
        settled = true; clearTimeout(timer); abort = null
        if (error) { discard(); reject(error) } else resolve(value!)
      }
      const timer = setTimeout(() => finish(new Error('Tempo excedido ao renderizar Template.')), timeoutMs)
      abort = error => finish(error)
      try {
        if (!host) {
          const created = createHost(); host = created
          created.onGone(reason => {
            if (host !== created) return
            discard(); abort?.(new Error(`Renderizador de Templates encerrado (${reason}).`))
          })
          ready = created.load()
        }
        const current = host
        ready!.then(() => current.run(checked)).then(value => finish(null, value), error => finish(error instanceof Error ? error : new Error(String(error))))
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    }))
    queue = action.then(() => {}, () => {}); return action
  }
  return { render, dispose() { stopped = true; abort?.(new Error('Renderizador encerrado.')); discard() } }
}

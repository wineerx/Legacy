import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, safeStorage } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { openDb } from './db/client'
import { ensureDefaultWorkspace, listWorkspaces } from './repos/workspaces'
import { getSetting } from './repos/settings'
import { listJobs } from './queue/queue'
import { startWorker } from './supervisor'
import { publicationFeedback } from './services/publication-history'
import { createGuestSession } from './services/guest-session'
import { createDispatcher } from './ipc/dispatcher'
import { buildHandlers } from './ipc/handlers'
import { parseMediaUrl } from './media-protocol'
import { createTray } from './tray'
import type { Tray } from 'electron'
import { startReminders } from './reminders'
import { EVENTS } from '@shared/ipc-contract'
import type { Ctx } from './context'
import { mediaAssets } from './db/schema'
import { decryptSecret, secretSnapshot, type SecretVault } from './services/integrations'
import electronUpdater from 'electron-updater'
import { setupUpdates } from './services/updates'

protocol.registerSchemesAsPrivileged([{ scheme: 'legacy-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let dataRoot = ''
const res = (...p: string[]) => (app.isPackaged ? join(process.resourcesPath, ...p) : resolve(...p))
const migrationsDir = app.isPackaged ? res('migrations') : resolve('src/main/db/migrations')
const ffmpegDir = app.isPackaged ? res('bin') : resolve('resources/bin/win32-x64')
const iconPath = res(app.isPackaged ? 'tray.png' : 'resources/tray.png')
const appIconPath = res(app.isPackaged ? 'icon.ico' : 'resources/icon.ico')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let shuttingDown = false

function showWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    title: `Legacy ${process.env.LEGACY_APP_VERSION} · ${process.env.LEGACY_BUILD_COMMIT?.slice(0, 7)}`,
    icon: appIconPath,
    width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: '#0B0B0B', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  if (process.platform === 'win32') {
    w.setAppDetails({ appId: 'app.legacy.desktop', appIconPath, appIconIndex: 0 })
  }
  w.on('page-title-updated', e => e.preventDefault())
  w.once('ready-to-show', () => w.show())
  w.on('session-end', () => { quitting = true })
  w.on('closed', () => { if (win === w) win = null })
  w.webContents.setWindowOpenHandler(({ url }) => {
    try { if (['www.instagram.com','developers.facebook.com'].includes(new URL(url).hostname) && new URL(url).protocol==='https:') void shell.openExternal(url) } catch { /* malformed external URL */ }
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return w
}

if (gotLock) {
  dataRoot = process.env.LEGACY_DATA_DIR ?? app.getPath('userData')
  mkdirSync(dataRoot, { recursive: true })
  app.whenReady().then(() => {
  app.setAppUserModelId('app.legacy.desktop')
  const { db, close } = openDb(join(dataRoot, 'legacy.sqlite'), migrationsDir)
  ensureDefaultWorkspace(db, Intl.DateTimeFormat().resolvedOptions().timeZone)
  const ctx: Ctx = { db, dataRoot, clock: () => new Date() }
  const vault: SecretVault = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
  ctx.secret = (ws, key) => decryptSecret(ctx, vault, ws, key)
  const send = (channel: string, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload) }

  protocol.handle('legacy-media', async (req) => {
    try {
      const roots = db.select({ path: mediaAssets.filePath }).from(mediaAssets).all().map((a) => dirname(a.path))
      const r = await net.fetch(pathToFileURL(parseMediaUrl(req.url, dataRoot, roots)).toString())
      const h = new Headers(r.headers)
      h.set('Access-Control-Allow-Origin', '*')
      return new Response(r.body, { status: r.status, headers: h })
    } catch {
      return new Response('Acesso negado', { status: 403 })
    }
  })

  for (const workspace of listWorkspaces(db)) publicationFeedback(ctx, workspace.id)
  const worker = startWorker({ initiallyPaused: true, dbPath: join(dataRoot, 'legacy.sqlite'), dataRoot, migrationsDir, ffmpegDir, credentials: () => secretSnapshot(ctx, vault), onEvent: (e) => send(EVENTS.jobsChanged, e) })

  const session = createGuestSession(paused => worker.setPaused(paused))
  const updates = setupUpdates(electronUpdater.autoUpdater, app.isPackaged, () => listWorkspaces(db).some(w => listJobs(db, w.id, ['running']).length > 0), () => { quitting = true })
  const dispatch = createDispatcher(buildHandlers({
    updates, session,
    buildCommit: process.env.LEGACY_BUILD_COMMIT, buildTime: process.env.LEGACY_BUILD_TIME,
    ctx, vault, onSecretsChanged: () => worker.updateSecrets(), version: process.env.LEGACY_APP_VERSION ?? app.getVersion(), workerAlive: () => worker.isAlive(),
    onJobsChanged: (workspaceId) => send(EVENTS.jobsChanged, { workspaceId }),
    shell: { openPath: (p) => shell.openPath(p) },
    dialogs: {
      saveVideo: async name => (await dialog.showSaveDialog(win!, { title: 'Salvar cópia do vídeo', defaultPath: name, filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v'] }] })).filePath ?? null,
      pickStorageFolder: async () => (await dialog.showOpenDialog(win!, { title: 'Escolher pasta para vídeos', properties: ['openDirectory', 'createDirectory'] })).filePaths[0] ?? null,
      pickVideos: async () => (await dialog.showOpenDialog(win!, { title: 'Importar vídeos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v'] }] })).filePaths,
      pickImage: async () => (await dialog.showOpenDialog(win!, { title: 'Escolher imagem da capa', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }] })).filePaths[0] ?? null,
      pickMetricsFile: async () => (await dialog.showOpenDialog(win!, { title: 'Importar métricas', properties: ['openFile'], filters: [{ name: 'CSV ou JSON', extensions: ['csv', 'json'] }] })).filePaths[0] ?? null
    }
  }))
  ipcMain.handle('legacy:invoke', (_e, channel: string, input: unknown) => {
    if (!session.get().entered && !['app.bootstrap', 'session.get', 'session.enterGuest', 'session.exit', 'updates.status'].includes(channel)) return { ok: false, error: { code: 'invalid_input', message: 'Entre como visitante para continuar.' } }
    return dispatch(channel, input)
  })

  win = createWindow()
  tray = createTray(iconPath, () => win, () => { quitting = true; app.quit() })
  const stopReminders = startReminders(db, (workspaceId) => { showWindow(); send(EVENTS.navigate, { page: 'notifications', workspaceId }) }, res(app.isPackaged ? 'icon.png' : 'resources/icon.png'))

  win.on('close', (e) => {
    if (quitting) return
    const ws = listWorkspaces(db)[0]
    const toTray = (ws && getSetting(db, ws.id, 'minimizeToTray')) !== 'false'
    if (toTray) { e.preventDefault(); win?.hide(); return }
    const running = listWorkspaces(db).some((w) => listJobs(db, w.id, ['running', 'queued']).length > 0)
    if (!running) return
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'warning', buttons: ['Cancelar', 'Fechar'], defaultId: 0, cancelId: 0, title: 'Fechar o Legacy?',
      message: 'Há tarefas em andamento ou na fila. Fechar interrompe o processamento até você abrir o app de novo.'
    })
    if (choice === 0) e.preventDefault()
  })

  app.on('second-instance', () => { showWindow() })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', (e) => {
    if (shuttingDown) return
    shuttingDown = true
    e.preventDefault()
    void (async () => {
      try {
        stopReminders()
        await Promise.race([worker.stop(), new Promise((r) => setTimeout(r, 6000))])
        close()
      } catch (err) {
        console.error('[shutdown]', err)
      } finally {
        app.exit(0)
      }
    })()
  })
  })
}

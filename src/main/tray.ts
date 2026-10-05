import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'

export function createTray(iconPath: string, getWindow: () => BrowserWindow | null, quit: () => void): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('Legacy — agendador ativo')
  const show = () => { const w = getWindow(); if (w) { w.show(); w.focus() } }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Legacy', click: show },
    { type: 'separator' },
    { label: 'Sair', click: quit }
  ]))
  tray.on('click', show)
  return tray
}

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBridge, renderWithApp, WS_ID } from '../../test-utils'
import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  it('escolhe uma pasta e permite restaurar o padrão', async () => {
    let folder = { path: 'C:\\media', custom: false }
    const invoke = mockBridge({
      'settings.get': () => null,
      'storage.get': () => folder,
      'storage.choose': () => { folder = { path: 'D:\\Legacy\\videos', custom: true }; return folder },
      'storage.reset': () => { folder = { path: 'C:\\media', custom: false }; return folder }
    })
    renderWithApp(<SettingsPage navigate={vi.fn()} />)
    expect(await screen.findByText('C:\\media')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Alterar pasta dos vídeos' }))
    expect(await screen.findByText('D:\\Legacy\\videos')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restaurar pasta padrão' }))
    expect(await screen.findByText('C:\\media')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('storage.choose', { workspaceId: WS_ID })
    expect(invoke).toHaveBeenCalledWith('storage.reset', { workspaceId: WS_ID })
  })
  it('toggles ligados por padrão e desliga a bandeja', async () => {
    const invoke = mockBridge({ 'settings.get': () => null, 'settings.set': () => null })
    renderWithApp(<SettingsPage navigate={vi.fn()} />)
    const tray = await screen.findByRole('switch', { name: 'Manter na bandeja ao fechar' })
    expect(tray).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Remover metadados opcionais por padrão' })).toBeChecked()
    await userEvent.click(tray)
    expect(invoke).toHaveBeenCalledWith('settings.set', { workspaceId: WS_ID, key: 'minimizeToTray', value: 'false' })
  })

  it('Sobre mostra a pasta de dados', async () => {
    mockBridge({ 'settings.get': () => null })
    renderWithApp(<SettingsPage navigate={vi.fn()} />)
    expect(await screen.findByText('Pasta de dados: C:\\Users\\teste\\AppData\\Roaming\\Legacy')).toBeInTheDocument()
  })
})

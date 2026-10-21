import type { ElectronApplication, Page } from '@playwright/test'

// Configurações saiu do menu lateral; o acesso fica no menu do perfil.
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu do usuário' }).click()
  await page.getByRole('button', { name: 'Configurações' }).click()
}

/**
 * GitHub's Windows runners have a 1024×768 screen, which shrinks the 1440×900 window and changes layout
 * (the first-steps card covers sidebar links; the profile list divider only exists from 1280 px).
 * Specs that assume the desktop layout pin the viewport. LEGACY_E2E_SMALL_SCREEN=1 shrinks the window
 * first, to reproduce the runner locally; =unpinned also skips the pin, to see the original failures.
 */
export async function desktopViewport(app: ElectronApplication, page: Page): Promise<void> {
  const small = process.env.LEGACY_E2E_SMALL_SCREEN
  if (small === '1' || small === 'unpinned') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 728))
  if (small !== 'unpinned') await page.setViewportSize({ width: 1440, height: 900 })
}

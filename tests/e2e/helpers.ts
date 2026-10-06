import type { Page } from '@playwright/test'

// Configurações saiu do menu lateral; o acesso fica no menu do perfil.
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Menu do usuário' }).click()
  await page.getByRole('button', { name: 'Configurações' }).click()
}

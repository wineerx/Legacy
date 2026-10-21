import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('primeiros passos permanece dentro da sidebar e reabre sem o texto removido', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-first-steps-'))
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'chromium')}`], env: { ...process.env, LEGACY_DATA_DIR: join(root, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    const card = page.locator('.first-steps-card')
    await expect(card).toBeVisible()
    for (const width of [1280, 900]) {
      await page.setViewportSize({ width, height: 760 })
      const bounds = (await page.getByRole('navigation', { name: 'Principal' }).boundingBox())!
      const box = (await card.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(bounds.x + 8)
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width - 8)
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(card.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Menu do usuário' })).toBeVisible()
    }
    await expect(page.getByText('Dispensar oculta este widget.', { exact: false })).toHaveCount(0)
    await page.getByRole('button', { name: 'Fechar primeiros passos' }).click()
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: 'Recolher menu', exact: true }).click()
    await page.getByRole('button', { name: 'Expandir menu', exact: true }).click()
    await expect(card).toHaveCount(0)
    await page.getByRole('button', { name: 'Mostrar primeiros passos' }).click()
    await expect(card).toBeVisible()
  } finally { await app.close() }
})

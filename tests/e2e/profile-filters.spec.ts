import { test, expect, _electron as electron } from '@playwright/test'
import { desktopViewport } from './helpers'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('filtros alinhados, arraste para arquivar e restauração persistente', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-filters-'))
  const app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'chromium')}`],
    env: { ...process.env, LEGACY_DATA_DIR: join(root, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' }
  })
  try {
    const page = await app.firstWindow()
    await desktopViewport(app, page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    page.on('pageerror', error => console.error('Renderer:', error.message))
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    await page.evaluate(async () => {
      const result = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>
      if (!result.ok) throw Error('bootstrap')
      const workspaceId = result.data.workspaces[0].id
      const first = await window.legacy.invoke('profiles.add', { workspaceId, url: '@example' }) as IpcResult<Outputs['profiles.add']>
      const second = await window.legacy.invoke('profiles.add', { workspaceId, url: '@outro.perfil' }) as IpcResult<Outputs['profiles.add']>
      await window.legacy.invoke('profiles.add', { workspaceId, url: '@perfil.com.nome.muito.longo' })
      if (!first.ok || !second.ok) throw Error(JSON.stringify({ first, second }))
    })
    await page.getByRole('link', { name: 'Perfis', exact: true }).click()
    const sidebar = page.locator('aside').filter({ has: page.getByLabel('Link do perfil', { exact: true }) })
    expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const longCard = page.getByRole('button', { name: '@perfil.com.nome.muito.longo', exact: true })
    await longCard.hover()
    const row = longCard.locator('..')
    const optionsBox = (await row.getByRole('button', { name: 'Opções de @perfil.com.nome.muito.longo' }).boundingBox())!
    const rowBox = (await row.boundingBox())!
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width)
    await page.getByLabel('Texto na legenda', { exact: true }).fill('viagem')
    await page.getByRole('button', { name: 'Filtros avançados' }).click()
    const inputs = ['Mínimo de views', 'Mínimo de curtidas', 'Mínimo de comentários'].map(name => page.getByRole('spinbutton', { name, exact: true }))
    const boxes = await Promise.all(inputs.map(input => input.boundingBox()))
    expect(boxes.every(box => box && Math.abs(box.y - boxes[0]!.y) < 2)).toBe(true)
    expect(boxes.every(box => box && Math.abs(box.width - boxes[0]!.width) < 2)).toBe(true)
    await inputs[1].fill('100')
    await expect(page.locator('.ds-filter-panel')).toBeVisible()
    const folder = resolve('docs/screens/qa-filters')
    mkdirSync(folder, { recursive: true })
    await page.getByRole('heading', { name: '@example', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(folder, 'perfis.png') })
    await page.getByRole('button', { name: 'Filtros avançados' }).click()
    await page.getByRole('button', { name: 'Remover filtro: Legenda: viagem' }).click()
    await expect(page.getByRole('button', { name: 'Remover filtro: Curtidas ≥ 100' })).toBeVisible()
    const card = page.getByRole('button', { name: '@example', exact: true })
    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + 35, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 105, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(card).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 64, 0)')
    const openedBox = (await card.boundingBox())!
    const archiveBox = (await page.getByRole('button', { name: 'Arquivar @example', exact: true }).boundingBox())!
    expect(Math.abs(openedBox.x - (archiveBox.x + archiveBox.width))).toBeLessThan(1)
    expect(Math.abs(openedBox.x + openedBox.width - (box.x + box.width))).toBeLessThan(1)
    expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: join(folder, 'arraste.png') })
    await page.getByRole('button', { name: 'Arquivar @example', exact: true }).click()
    await expect(page.getByRole('heading', { name: '@outro.perfil', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Perfis arquivados', exact: true }).click()
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click()
    await expect(page.getByRole('heading', { name: '@example', exact: true })).toBeVisible()
    const resizeHandle = page.getByRole('separator', { name: 'Ajustar largura da lista de perfis' })
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '280')
    await expect(resizeHandle).toHaveCSS('cursor', 'col-resize')
    const handleBox = (await resizeHandle.boundingBox())!
    const sidebarBox = (await sidebar.boundingBox())!
    expect(Math.abs(handleBox.y + handleBox.height / 2 - (sidebarBox.y + sidebarBox.height / 2))).toBeLessThan(1)
    const resize = async (delta: number) => {
      const handle = (await resizeHandle.boundingBox())!
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2 + delta, handle.y + handle.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    await resize(64)
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '344')
    expect(Math.round((await sidebar.locator('..').boundingBox())!.width)).toBe(344)
    await page.reload()
    await page.getByRole('link', { name: 'Perfis', exact: true }).click()
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '344')
    await resize(600)
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '400')
    await resize(-700)
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
    expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await resizeHandle.dblclick()
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '280')
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(resizeHandle).toBeHidden()
    await page.getByRole('button', { name: 'Filtros avançados' }).click()
    await expect(inputs[2]).toBeVisible()
    await expect(page.locator('.ds-filter-panel')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: join(folder, 'perfis-compacto.png') })
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('button', { name: 'Filtros', exact: true }).click()
    await page.getByLabel('Perfil de origem', { exact: true }).fill('example')
    await expect(page.getByRole('button', { name: 'Remover filtro: Origem: example' })).toBeVisible()
    await expect(page.locator('.ds-filter-panel')).toBeVisible()
    await page.screenshot({ path: join(folder, 'biblioteca.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
    await expect(page.getByText('Sem filtros aplicados', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Menu do usuário' }).click()
    const userMenu = page.getByRole('dialog', { name: 'Menu da conta' })
    await expect(userMenu.getByText('guest@legacy.com', { exact: true })).toBeVisible()
    await expect(userMenu.getByRole('button', { name: 'Editar perfil local' })).toBeVisible()
    await expect(userMenu.getByRole('button', { name: 'Configurações' })).toBeVisible()
    const logout = userMenu.getByRole('button', { name: 'Sair', exact: true })
    await expect(logout).toBeVisible()
    await expect(logout.locator('svg')).toHaveCSS('color', 'rgb(252, 165, 165)')
    const menuBox = (await userMenu.boundingBox())!
    const viewport = page.viewportSize()!
    expect(menuBox.x).toBeGreaterThanOrEqual(16)
    expect(menuBox.y).toBeGreaterThanOrEqual(16)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 16)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 16)
    await page.screenshot({ path: join(folder, 'menu-usuario.png') })
    await userMenu.getByRole('button', { name: 'Configurações' }).click()
    await expect(page.getByRole('heading', { name: 'Geral', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})


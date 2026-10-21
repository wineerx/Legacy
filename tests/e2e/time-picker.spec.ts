import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('seletor de horário escuro preserva digitação, seleção e foco', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-time-picker-'))
  const video = join(root, 'horario.mp4')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=1', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), `--user-data-dir=${join(root, 'chromium')}`], env: { ...process.env, LEGACY_DATA_DIR: join(root, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    await page.evaluate(async source => {
      const boot = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>
      if (!boot.ok) throw Error('bootstrap')
      const result = await window.legacy.invoke('library.importPaths', { workspaceId: boot.data.workspaces[0].id, paths: [source] }) as IpcResult<Outputs['library.importPaths']>
      if (!result.ok) throw Error(JSON.stringify(result))
    }, video)
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('button', { name: 'Selecionar página', exact: true }).click()
    await page.getByRole('button', { name: 'Preparar lote', exact: true }).click()
    await page.getByRole('switch', { name: 'Lembretes para postar', exact: true }).check()
    const input = page.getByLabel('Hora', { exact: true })
    await input.fill('23:59')
    const trigger = page.getByRole('button', { name: 'Selecionar horário: Hora', exact: true })
    await trigger.click()
    const popup = page.getByRole('dialog', { name: 'Seletor de horário: Hora' })
    await expect(popup).toBeVisible()
    await expect(popup).toHaveCSS('width', '218px')
    for (const label of ['Hora 23', 'Minuto 59']) {
      const selected = page.getByRole('radio', { name: label, exact: true })
      await expect(selected).toHaveAttribute('aria-checked', 'true')
      await expect.poll(() => selected.evaluate(element => { const item = element.getBoundingClientRect(); const column = element.parentElement!.getBoundingClientRect(); return item.top >= column.top && item.bottom <= column.bottom })).toBe(true)
    }
    await page.getByRole('radio', { name: 'Hora 00', exact: true }).click()
    await page.getByRole('radio', { name: 'Minuto 07', exact: true }).click()
    await expect(input).toHaveValue('00:07')
    const folder = resolve('docs/screens/qa-filters')
    mkdirSync(folder, { recursive: true })
    await page.screenshot({ path: join(folder, 'time-picker.png') })
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(trigger).toBeFocused()
  } finally { await app.close() }
})


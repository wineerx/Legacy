import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('diagnóstico integrado: recolhido, busca, rede, fila, resize, navegação e exportação', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-diagnostics-'))
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Console', exact: true })).toHaveCount(0)
    await expect(page.getByText('Processador ativo', { exact: true })).toBeVisible()
    const ws = await page.evaluate(async () => { const boot = await window.legacy.invoke('app.bootstrap', {}) as any; return boot.data.workspaces[0].id })
    await app.evaluate(({ app }, input) => {
      const req = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const db = new (req('better-sqlite3'))(input.db)
      try {
        const now = new Date().toISOString()
        db.prepare('INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,attempts,max_attempts,last_error,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('diagnostic-job', input.ws, 'publish_instagram', '{}', 'Publicação aguardando confirmação', 'running', now, 2, 3, null, JSON.stringify({ containerId: 'test-container', publishing: true }), now, now)
      } finally { db.close() }
    }, { ws, db: join(dir, 'data', 'legacy.sqlite') })
    await page.evaluate(async workspaceId => {
      await window.legacy.invoke('jobs.details', { workspaceId, id: 'missing' })
      await window.legacy.invoke('jobs.details', { workspaceId, id: 'missing' })
    }, ws)
    await page.getByRole('button', { name: /Diagnóstico/ }).click()
    const panel = page.locator('.diagnostic-panel')
    await expect(page.getByRole('tab', { name: 'Console', exact: true })).toHaveAttribute('data-state', 'active')
    await page.getByLabel('Buscar logs', { exact: true }).fill('missing')
    await expect(panel.getByText(/de [1-9]/)).toBeVisible()
    await expect(panel.locator('mark').first()).toBeVisible()
    await page.getByLabel('Buscar logs', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await expect(panel.getByText(/Visualização pausada/)).toBeVisible()
    await page.getByRole('button', { name: 'Retomar', exact: true }).click()
    await page.getByRole('tab', { name: 'Network', exact: true }).click()
    await expect(panel.getByText('Falha IPC').first()).toBeVisible()
    await page.getByRole('tab', { name: 'Fila', exact: true }).click()
    await expect(panel.getByText('Publishing', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: /diagnost/ }).click()
    await expect(page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar detalhes', exact: true }).click()
    const resize = page.getByRole('separator', { name: 'Altura do painel técnico' })
    const before = Number(await resize.getAttribute('aria-valuenow'))
    await resize.focus(); await page.keyboard.press('ArrowUp')
    await expect(resize).toHaveAttribute('aria-valuenow', String(before + 20))
    await page.getByRole('tab', { name: 'Console', exact: true }).click()
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }) }, join(dir, 'diagnostics.json'))
    await panel.getByRole('button', { name: 'Exportar', exact: true }).click()
    await expect(page.getByText('Diagnóstico exportado.', { exact: true })).toBeVisible()
    const exported = await app.evaluate((_, destination) => JSON.parse(process.getBuiltinModule('node:fs')!.readFileSync(destination, 'utf8')), join(dir, 'diagnostics.json'))
    expect(exported.queue.items.some((j: any) => j.id === 'diagnostic-job' && j.state === 'running')).toBe(true)
    expect(exported.checkpoints[0].publishing).toBe(true)
    await page.screenshot({ path: join(dir, 'diagnostics.png') })
    console.log('Diagnóstico screenshot:', join(dir, 'diagnostics.png'))
    await page.getByRole('button', { name: 'Recolher painel técnico', exact: true }).click()
    await page.getByRole('button', { name: /Diagnóstico/ }).click()
    await expect(resize).toHaveAttribute('aria-valuenow', String(before + 20))
    await expect(page.getByRole('tab', { name: 'Console', exact: true })).toHaveAttribute('data-state', 'active')
  } finally { await app.close() }
})

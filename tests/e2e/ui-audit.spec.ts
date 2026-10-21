import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

/** Temporary UI audit capture: every main screen with realistic synthetic data, isolated profile and DB. */
test('captura auditoria de UI', async () => {
  test.setTimeout(240_000)
  const out = process.env.UI_AUDIT_DIR ?? resolve('test-results/ui-audit')
  mkdirSync(out, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'legacy-ui-audit-')), video = join(dir, 'clip.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=3', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    const ws = await page.evaluate(async () => { const r = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>; if (!r.ok) throw Error('b'); return r.data.workspaces[0].id })
    await app.evaluate(({ safeStorage, app }, input) => {
      const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const Database = require('better-sqlite3'), conn = new Database(input.db)
      try {
        const put = conn.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: '365spiders', revision: 'r', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('synthetic').toString('base64'))
        const insert = conn.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,3000,360,640,'h264','none','{}',?)")
        for (let n = 0; n < 24; n++) insert.run(`u-${n}`, input.ws, `meme-${n}.mp4`, input.video, `ui-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString())
        const now = new Date().toISOString()
        conn.prepare("INSERT INTO provider_quota_snapshots(workspace_id,provider,account_id,source,quota_usage,quota_total,quota_duration_sec,fetched_at,attempted_at,last_status) VALUES(?,'instagram','123456','instagram.content_publishing_limit',18,50,86400,?,?,'ok')").run(input.ws, now, now)
        conn.prepare("INSERT INTO provider_limits(workspace_id,provider,account_id,operation,cooldown_until,failures) VALUES(?,'instagram','123456','quota_status',?,1)").run(input.ws, new Date(Date.now() + 86_400_000).toISOString())
      } finally { conn.close() }
    }, { ws, video, db })
    await page.evaluate(async ws => {
      const start = new Date(Date.now() + 86_400_000); start.setHours(13, 0, 0, 0)
      const d = await window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name: 'Memes da semana', provider: 'instagram', destinationAccountId: '123456', accountRevision: 'r', plannedStartAt: start.toISOString(), intervalMin: 15, items: Array.from({ length: 12 }, (_, n) => ({ assetId: `u-${n}` })) } }) as IpcResult<Outputs['containers.create']>
      if (d.ok) await window.legacy.invoke('containers.schedule', { workspaceId: ws, containerId: d.data.container.id, expectedRevision: d.data.container.revision })
      await window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name: 'Rascunho noturno', provider: 'instagram', destinationAccountId: '123456', accountRevision: 'r', items: Array.from({ length: 4 }, (_, n) => ({ assetId: `u-${12 + n}` })) } })
    }, ws)
    { const close = page.getByRole('button', { name: 'Fechar primeiros passos', exact: true }); await page.screenshot({ path: join(out, '00-overview-firststeps.png') }); if (await close.isVisible()) await close.click() }
    const shots: [string, string][] = [['Visão geral', '01-overview'], ['Perfis', '02-profiles'], ['Biblioteca', '03-library'], ['Criar postagem', '04-compose'], ['Templates', '05-templates'], ['Calendário', '06-calendar'], ['Fila', '07-queue'], ['Contas', '08-accounts'], ['Notificações', '09-notifications'], ['Desafios e conquistas', '10-achievements'], ['Tutoriais', '11-tutorial']]
    for (const [label, name] of shots) { await page.getByRole('link', { name: label, exact: true }).click(); await page.waitForTimeout(700); await page.screenshot({ path: join(out, `${name}.png`) }) }
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click(); await page.waitForTimeout(400)
    await page.getByText('Filtros de origem e publicação').first().click().catch(() => {}); await page.waitForTimeout(400)
    await page.screenshot({ path: join(out, '12-library-filters.png') })
    await page.getByRole('checkbox', { name: 'Selecionar meme-23.mp4' }).check().catch(() => {}); await page.waitForTimeout(300)
    await page.screenshot({ path: join(out, '12b-library-selection.png') })
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).first().click(); await page.waitForTimeout(500)
    await page.screenshot({ path: join(out, '13-containers-sheet.png') })
    // Keyboard: a single Escape closes the Sheet (focus no longer lands on the tooltip-bearing close button).
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
    const switcher = page.getByRole('button', { name: /Conta ativa/ })
    await switcher.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('list', { name: 'Contas conectadas' })).toBeVisible()
    await page.screenshot({ path: join(out, '14-account-switcher.png') })
    await page.keyboard.press('Escape'); await expect(page.getByRole('list', { name: 'Contas conectadas' })).toHaveCount(0)
    await expect(switcher).toBeFocused()
    await page.getByRole('button', { name: 'Menu do usuário' }).click(); await page.getByRole('button', { name: 'Configurações' }).click(); await page.waitForTimeout(500)
    await page.screenshot({ path: join(out, '15-settings.png'), fullPage: true })
  } finally { await app.close() }
})

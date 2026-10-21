import { test, expect, _electron as electron } from '@playwright/test'
import { desktopViewport } from './helpers'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'
import { zonedToUtc } from '../../src/shared/schedule'
import { localDate, addDays } from '../../src/shared/agenda'

/** PR 10 in the real app: dragging a Container shows the impact, and only the confirmation moves its jobs. */
test('Calendário move Container arrastando, com prévia de impacto e confirmação', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-calendar-drag-e2e-')), video = join(dir, 'fixture.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await desktopViewport(app, page)
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    const boot = await page.evaluate(async () => { const r = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>; if (!r.ok) throw Error('bootstrap'); return r.data.workspaces[0] })
    await app.evaluate(({ safeStorage, app }, input) => {
      const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const Database = require('better-sqlite3'), conn = new Database(input.db)
      try {
        const put = conn.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: 'qa.agenda', revision: 'qa-rev', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('qa-synthetic-token').toString('base64'))
        const insert = conn.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,2000,360,640,'h264','none','{}',?)")
        for (let n = 0; n < 16; n++) insert.run(`a-${n}`, input.ws, `agenda-${n}.mp4`, input.video, `agenda-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString())
      } finally { conn.close() }
    }, { ws: boot.id, video, db })
    const tomorrow = addDays(localDate(Date.now(), boot.timeZone), 1)
    const start = zonedToUtc(tomorrow, '13:00', boot.timeZone).toISOString(), draftStart = zonedToUtc(tomorrow, '18:00', boot.timeZone).toISOString()
    await page.evaluate(async ({ ws, start, draftStart }) => {
      const make = (name: string, plannedStartAt: string, ids: string[]) => window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name, provider: 'instagram', destinationAccountId: '123456', accountRevision: 'qa-rev', plannedStartAt, intervalMin: 15, items: ids.map(assetId => ({ assetId })) } }) as Promise<IpcResult<Outputs['containers.create']>>
      const meme = await make('Container Meme', start, Array.from({ length: 12 }, (_, n) => `a-${n}`))
      if (!meme.ok) throw Error(JSON.stringify(meme))
      const s = await window.legacy.invoke('containers.schedule', { workspaceId: ws, containerId: meme.data.container.id, expectedRevision: meme.data.container.revision }) as IpcResult<Outputs['containers.schedule']>
      if (!s.ok) throw Error(JSON.stringify(s))
      const draft = await make('Rascunho noturno', draftStart, ['a-12', 'a-13', 'a-14', 'a-15'])
      if (!draft.ok) throw Error(JSON.stringify(draft))
    }, { ws: boot.id, start, draftStart })

    await page.getByRole('link', { name: 'Calendário', exact: true }).click()
    await page.getByRole('button', { name: 'Dia', exact: true }).click()
    await page.getByRole('button', { name: 'Próximo período', exact: true }).click()
    const runAts = () => page.evaluate(async ws => { const r = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>; return r.ok ? r.data.map(j => j.runAt).sort() : [] }, boot.id)
    const before = await runAts()
    expect(before[0]).toBe(start)

    // A draft is not draggable: no impact dialog opens.
    const draftBox = (await page.getByRole('button', { name: 'Abrir Rascunho noturno', exact: true }).boundingBox())!
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + 10); await page.mouse.down()
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + 106, { steps: 8 }); await page.mouse.up()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Drag the scheduled Container two hours later (48 px per hour in the time grid).
    const block = page.getByRole('button', { name: 'Abrir Container Meme', exact: true })
    const box = (await block.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 12); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 6 })
    await expect(page.locator('[data-agenda-day] .border-dashed').filter({ hasText: '→' }).first()).toBeVisible()
    await page.mouse.move(box.x + box.width / 2, box.y + 12 + 96, { steps: 6 }); await page.mouse.up()
    const dialog = page.getByRole('dialog', { name: 'Mover Container Meme?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('12 vídeo(s) reagendado(s)', { exact: true })).toBeVisible()
    await expect(dialog.getByText('+2 h', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'Impacto da movimentação' }).or(dialog)).toContainText('15:00')
    mkdirSync('docs/screens/qa-calendar', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-calendar/arrastar-impacto.png' })
    expect(await runAts()).toEqual(before) // nothing moved yet

    // Cancel keeps everything; confirming moves all twelve jobs by the same two hours.
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await runAts()).toEqual(before)
    await page.mouse.move(box.x + box.width / 2, box.y + 12); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 12 + 96, { steps: 8 }); await page.mouse.up()
    await dialog.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Container Meme' })).toContainText('15:00 → 17:45')
    expect(await runAts()).toEqual(before.map(t => new Date(Date.parse(t) + 2 * 3_600_000).toISOString()))
    await page.screenshot({ path: 'docs/screens/qa-calendar/arrastar-aplicado.png' })

    // The keyboard alternative opens the same confirmation.
    await page.getByRole('button', { name: 'Abrir Container Meme', exact: true }).focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('−15 min', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()

    // The move is recorded in the Container adjustments.
    await page.getByRole('button', { name: 'Abrir Container Meme', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Container Meme' })
    await sheet.getByRole('button', { name: 'Reagendar', exact: true }).click()
    await expect(sheet.getByText(/Movido no Calendário/)).toBeAttached()
    expect(errors).toEqual([])
  } finally { await app.close() }
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

/**
 * PR 07 in the real app: a scheduled Container is delayed (the queue's quota deferral is simulated by shifting
 * run_at in the database, as the worker would), the window shows the delay, and an explicit "Reduzir intervalo"
 * moves only fresh items. Schedules are for tomorrow; provider network is off (playwright.config).
 */
test('Janela do Container → atraso → reduzir intervalo com confirmação → histórico', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-window-e2e-')), video = join(dir, 'fixture.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  const sql = (statement: string, args: unknown[] = []) => app.evaluate(({ app }, input) => {
    const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
    const Database = require('better-sqlite3'), conn = new Database(input.db)
    try { return input.statement.trim().startsWith('SELECT') ? conn.prepare(input.statement).all(...input.args) : conn.prepare(input.statement).run(...input.args) } finally { conn.close() }
  }, { db, statement, args })
  try {
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    const ws = await page.evaluate(async () => { const r = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>; if (!r.ok) throw Error('bootstrap'); return r.data.workspaces[0].id })
    await app.evaluate(({ safeStorage, app }, input) => {
      const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const Database = require('better-sqlite3'), conn = new Database(input.db)
      try {
        const put = conn.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: 'qa.janela', revision: 'qa-rev', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('qa-synthetic-token').toString('base64'))
        const insert = conn.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,2000,360,640,'h264','none','{}',?)")
        for (let n = 0; n < 4; n++) insert.run(`w-${n}`, input.ws, `janela-${n}.mp4`, input.video, `janela-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString())
      } finally { conn.close() }
    }, { ws, video, db })
    // Tomorrow, 4 videos every 30 min: planned window start → start + 90 min.
    const c = await page.evaluate(async ws => {
      const start = new Date(Date.now() + 86_400_000); start.setSeconds(0, 0)
      const d = await window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name: 'Container janela', provider: 'instagram', destinationAccountId: '123456', accountRevision: 'qa-rev', plannedStartAt: start.toISOString(), intervalMin: 30, items: [0, 1, 2, 3].map(n => ({ assetId: `w-${n}` })) } }) as IpcResult<Outputs['containers.create']>
      if (!d.ok) throw Error(JSON.stringify(d))
      const s = await window.legacy.invoke('containers.schedule', { workspaceId: ws, containerId: d.data.container.id, expectedRevision: d.data.container.revision }) as IpcResult<Outputs['containers.schedule']>
      if (!s.ok) throw Error(JSON.stringify(s)); return { id: d.data.container.id, jobs: s.data.jobs.map(j => j.id) }
    }, ws)
    // What the queue does after a quota refusal: the pending sequence shifts by the same offset (here 90 min).
    await sql("UPDATE jobs SET run_at = strftime('%Y-%m-%dT%H:%M:%fZ', run_at, '+90 minutes')")

    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
    await page.getByRole('group', { name: 'Containers' }).getByRole('button', { name: 'Agendados', exact: true }).click()
    await page.getByRole('button', { name: /Container janela.*\+90 min · 0\/4/ }).click()
    const panel = page.getByRole('region', { name: 'Janela do Container' })
    await expect(panel.getByRole('alert')).toHaveText('O Container ultrapassará sua janela em 1 h 30 min.')
    await expect(panel.getByText('Mover restante: Configure janelas de pico para mover o restante.', { exact: true })).toBeVisible()
    mkdirSync('docs/screens/qa-window', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-window/janela-atrasada.png' })
    const before = await sql('SELECT id, run_at FROM jobs ORDER BY run_at') as { id: string; run_at: string }[]
    await panel.getByRole('button', { name: 'Reduzir intervalo', exact: true }).click()
    expect(await sql('SELECT id, run_at FROM jobs ORDER BY run_at')).toEqual(before)
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar ajuste', exact: true }).click()
    await expect(panel.getByText('Ajuste aplicado aos vídeos ainda não enviados. Os demais seguem como estavam.', { exact: true })).toBeVisible()
    await expect(panel.getByText(/Ajustes registrados \(1\)/)).toBeVisible()

    const after = await sql('SELECT run_at FROM jobs ORDER BY run_at') as { run_at: string }[]
    const times = after.map(r => Date.parse(r.run_at))
    expect(times.slice(1).map((t, i) => (t - times[i]) / 60_000)).toEqual([15, 15, 15])
    expect(times[0]).toBe(Date.parse(before[0].run_at))
    const state = await page.evaluate(async ({ ws, id }) => {
      const r = await window.legacy.invoke('containers.window.get', { workspaceId: ws, containerId: id }) as IpcResult<Outputs['containers.window.get']>
      const c = await window.legacy.invoke('containers.get', { workspaceId: ws, containerId: id }) as IpcResult<Outputs['containers.get']>
      if (!r.ok || !c.ok) throw Error('window'); return { adjustments: r.data.adjustments, container: c.data.container }
    }, { ws, id: c.id })
    expect(state.adjustments).toMatchObject([{ kind: 'reduce', before: { intervalMin: 30 }, after: { intervalMin: 15 } }])
    expect(state.container).toMatchObject({ intervalMin: 15, delayMin: 45 })
    expect(await sql('SELECT count(*) n FROM publication_history')).toEqual([{ n: 0 }])
    expect(errors).toEqual([])
  } finally { await app.close() }
})

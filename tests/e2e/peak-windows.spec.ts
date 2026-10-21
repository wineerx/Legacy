import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'
import { openSettings } from './helpers'

/**
 * PR 06 in the real app: peak windows configured in Settings, four drafts distributed in selection order,
 * applied to drafts only, then one scheduled through the review (PR 05 check). Provider network is off
 * (playwright.config), the Meta reading is a simulated snapshot, schedules are in the future.
 */
test('Janelas de pico → distribuição de 4 Containers → aplicar aos rascunhos → agendar com quota', async () => {
  test.setTimeout(150_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-peak-e2e-')), video = join(dir, 'fixture.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
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
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: 'qa.pico', revision: 'qa-rev', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('qa-synthetic-token').toString('base64'))
        const insert = conn.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,2000,360,640,'h264','none','{}',?)")
        for (let n = 0; n < 48; n++) insert.run(`p-${n}`, input.ws, `pico-${n}.mp4`, input.video, `pico-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString())
        const now = new Date().toISOString()
        conn.prepare("INSERT INTO provider_quota_snapshots(workspace_id,provider,account_id,source,quota_usage,quota_total,quota_duration_sec,fetched_at,attempted_at,last_status) VALUES(?,'instagram','123456','instagram.content_publishing_limit',0,50,86400,?,?,'ok')").run(input.ws, now, now)
      } finally { conn.close() }
    }, { ws, video, db })

    // Settings: four windows typed by the user; nothing comes pre-filled.
    await openSettings(page)
    const panel = page.getByRole('region', { name: 'Janelas de pico' })
    await expect(panel.getByText('Nenhuma janela configurada')).toBeVisible()
    for (const [i, [start, end]] of [['09:00', '12:00'], ['13:00', '16:00'], ['17:00', '20:00'], ['21:00', '00:00']].entries()) {
      await panel.getByRole('button', { name: 'Adicionar janela', exact: true }).click()
      await panel.getByLabel(`Início da janela ${i + 1}`, { exact: true }).fill(start)
      await panel.getByLabel(`Fim da janela ${i + 1}`, { exact: true }).fill(end)
    }
    await expect(panel.getByText('Atravessa a meia-noite: termina às 00:00 do dia seguinte.')).toBeVisible()
    await panel.getByRole('button', { name: 'Salvar janelas', exact: true }).click()
    await expect(panel.getByText('Janelas salvas.', { exact: true })).toBeVisible()

    const ids = await page.evaluate(async ws => {
      const out: string[] = []
      for (const [k, name] of ['A', 'B', 'C', 'D'].entries()) {
        const r = await window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name: `Container ${name}`, provider: 'instagram', destinationAccountId: '123456', accountRevision: 'qa-rev', intervalMin: 15, items: Array.from({ length: 12 }, (_, n) => ({ assetId: `p-${k * 12 + n}` })) } }) as IpcResult<Outputs['containers.create']>
        if (!r.ok) throw Error(JSON.stringify(r)); out.push(r.data.container.id)
      }
      return out
    }, ws)

    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
    for (const name of ['A', 'B', 'C', 'D']) await page.getByRole('checkbox', { name: `Distribuir Container ${name}`, exact: true }).check()
    await page.getByRole('button', { name: 'Distribuir em horários de pico (4)', exact: true }).click()
    const region = page.getByRole('region', { name: 'Distribuição em horários de pico' })
    await expect(region.getByText('48 / 50', { exact: true })).toBeVisible()
    await expect(region.getByText(/Margem operacional: 2\./)).toBeVisible()
    mkdirSync('docs/screens/qa-peak', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-peak/distribuicao.png' })
    await region.getByRole('button', { name: 'Aplicar horários aos rascunhos', exact: true }).click()
    await expect(page.getByText('Horários aplicados a 4 rascunho(s). Nenhum job foi criado; revise e agende cada Container.', { exact: true })).toBeVisible()

    const state = await page.evaluate(async ({ ws, ids }) => {
      const out = []
      for (const id of ids) { const r = await window.legacy.invoke('containers.get', { workspaceId: ws, containerId: id }) as IpcResult<Outputs['containers.get']>; if (!r.ok) throw Error('get'); out.push(r.data.container) }
      const jobs = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>
      if (!jobs.ok) throw Error('jobs'); return { containers: out, jobs: jobs.data.length }
    }, { ws, ids })
    expect(state.jobs).toBe(0)
    const local = (iso: string) => new Date(iso).toLocaleTimeString('sv-SE', { timeZone: state.containers[0].timeZone }).slice(0, 5)
    const windows = [['09:00', '12:00'], ['13:00', '16:00'], ['17:00', '20:00'], ['21:00', '24:00']]
    for (const [i, c] of state.containers.entries()) {
      expect(c.state).toBe('draft')
      expect(Date.parse(c.plannedEndAt!) - Date.parse(c.plannedStartAt!)).toBe(165 * 60_000)
      const [s, e] = [local(c.plannedStartAt!), local(c.plannedEndAt!)]
      expect(windows.some(([a, b]) => s >= a && (e <= b || (b === '24:00' && e <= '23:59')))).toBe(true)
      if (i) expect(Date.parse(c.plannedStartAt!)).toBeGreaterThanOrEqual(Date.parse(state.containers[i - 1].plannedEndAt!) + 15 * 60_000)
    }

    // The review offers the configured window starts and the PR 05 check accepts the plan.
    await page.getByRole('button', { name: /Container A/ }).click()
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    const shortcuts = page.getByRole('radiogroup', { name: 'Início das janelas de pico' })
    await expect(shortcuts.getByRole('radio')).toHaveText(['09:00', '13:00', '17:00', '21:00'])
    await expect(page.getByRole('region', { name: 'Quota de publicação' }).getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Agendar Container', exact: true }).dblclick()
    await expect(page.getByText('Container agendado. A configuração visual está congelada.', { exact: true })).toBeVisible()
    const after = await page.evaluate(async ({ ws, id }) => {
      const r = await window.legacy.invoke('containers.get', { workspaceId: ws, containerId: id }) as IpcResult<Outputs['containers.get']>
      const jobs = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>
      if (!r.ok || !jobs.ok) throw Error('after'); return { container: r.data.container, jobs: jobs.data.length }
    }, { ws, id: ids[0] })
    expect(after.jobs).toBe(12)
    expect(after.container.plannedStartAt).toBe(state.containers[0].plannedStartAt)
    expect(errors).toEqual([])
  } finally { await app.close() }
})

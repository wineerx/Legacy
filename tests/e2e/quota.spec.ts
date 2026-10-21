import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

/**
 * PR 05 in the real app: the Meta reading is simulated by writing the snapshot the endpoint would produce.
 * A provider cooldown on quota reads keeps every refresh offline; schedules are days ahead, the worker never posts.
 */
test('Quota da conta na revisão → agendamento recusado acima da quota → aceito dentro dela, sem rede', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-quota-e2e-')), video = join(dir, 'fixture.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  const sql = (statements: { sql: string; args: unknown[] }[]) => app.evaluate(({ app }, input) => {
    const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
    const Database = require('better-sqlite3'), conn = new Database(input.db)
    try { return input.statements.map(s => s.sql.trim().startsWith('SELECT') ? conn.prepare(s.sql).all(...s.args) : conn.prepare(s.sql).run(...s.args)) } finally { conn.close() }
  }, { db, statements })
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
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: 'qa.quota', revision: 'qa-rev', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('qa-synthetic-token').toString('base64'))
        const insert = conn.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,2000,360,640,'h264','none','{}',?)")
        for (let n = 0; n < 4; n++) insert.run(`q-${n}`, input.ws, `quota-${n}.mp4`, input.video, `quota-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString())
        // What content_publishing_limit returned "now": 1 used of 3 in a 1 h window. Values are arbitrary on purpose.
        const now = new Date().toISOString()
        conn.prepare("INSERT INTO provider_quota_snapshots(workspace_id,provider,account_id,source,quota_usage,quota_total,quota_duration_sec,fetched_at,attempted_at,last_status) VALUES(?,'instagram','123456','instagram.content_publishing_limit',1,3,3600,?,?,'ok')").run(input.ws, now, now)
        // Any refresh attempt stays offline: quota reads of this account are cooling down for a day.
        conn.prepare("INSERT INTO provider_limits(workspace_id,provider,account_id,operation,cooldown_until,failures) VALUES(?,'instagram','123456','quota_status',?,1)").run(input.ws, new Date(Date.now() + 86_400_000).toISOString())
      } finally { conn.close() }
    }, { ws, video, db })
    const draft = (count: number, first = 0, days = 3) => page.evaluate(async ({ ws, count, first, days }) => {
      const start = new Date(Date.now() + days * 86_400_000); start.setSeconds(0, 0)
      const r = await window.legacy.invoke('containers.create', { workspaceId: ws, requestId: crypto.randomUUID(), draft: { name: `Quota ${count}`, provider: 'instagram', destinationAccountId: '123456', accountRevision: 'qa-rev', plannedStartAt: start.toISOString(), intervalMin: 15, items: Array.from({ length: count }, (_, n) => ({ assetId: `q-${first + n}` })) } }) as IpcResult<Outputs['containers.create']>
      if (!r.ok) throw Error(JSON.stringify(r)); return r.data.container.id
    }, { ws, count, first, days })
    const openReview = async (name: string) => {
      await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
      await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
      await page.getByRole('button', { name: new RegExp(name) }).click()
      await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
      return page.getByRole('region', { name: 'Quota de publicação' })
    }
    const jobs = () => page.evaluate(async ws => { const r = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>; if (!r.ok) throw Error('jobs'); return r.data.length }, ws)

    // Four items 15 min apart: the fourth would be the 4th publication inside a 1 h window of limit 3.
    await draft(4)
    const panel = await openReview('Quota 4')
    await expect(panel.getByText('1 de 3 em 1 h', { exact: true })).toBeVisible()
    await expect(panel.getByText('Atualizada', { exact: true })).toBeVisible()
    await expect(panel.getByRole('alert')).toContainText('1 publicação(ões) deste Container excedem a quota informada')
    mkdirSync('docs/screens/qa-quota', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-quota/revisao-acima-da-quota.png' })
    await page.getByRole('button', { name: 'Agendar Container', exact: true }).click()
    await expect(page.getByText(/A quota informada pela Meta \(3 publicações em 1 h, consulta de .*\) não comporta 1 publicação/)).toBeVisible()
    expect(await jobs()).toBe(0)
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()

    // Three items fit; after scheduling the panel counts them as reservations of the account.
    await draft(3)
    const fits = await openReview('Quota 3')
    await expect(fits.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Agendar Container', exact: true }).dblclick()
    await expect(page.getByText('Container agendado. A configuração visual está congelada.', { exact: true })).toBeVisible()
    expect(await jobs()).toBe(3)
    await expect(page.getByRole('region', { name: 'Quota de publicação' }).getByText('Já agendadas nesta conta').locator('xpath=following-sibling::dd[1]')).toHaveText('3')
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()

    // Stale reading: capacity becomes unknown; the explicit refresh honors the cooldown and never reaches Meta.
    await sql([{ sql: "UPDATE provider_quota_snapshots SET fetched_at=?, attempted_at=?", args: [new Date(Date.now() - 3_600_000).toISOString(), new Date(Date.now() - 3_600_000).toISOString()] }])
    await draft(1, 3, 4)
    const stale = await openReview('Quota 1')
    await expect(stale.getByText(/Capacidade desconhecida\./)).toBeVisible()
    await expect(stale.getByText(/Consulta de quota em espera até/)).toBeVisible()
    await stale.getByRole('button', { name: 'Atualizar quota', exact: true }).click()
    await expect(stale.getByText('Desatualizada', { exact: true })).toBeVisible()
    const [rows] = await sql([{ sql: 'SELECT last_status, error_kind, quota_total FROM provider_quota_snapshots', args: [] }]) as { last_status: string; error_kind: string; quota_total: number }[][]
    expect(rows).toEqual([{ last_status: 'error', error_kind: 'rate_limited', quota_total: 3 }])
    // Unknown capacity follows the existing policy: scheduling is allowed and the queue protects the account.
    await page.getByRole('button', { name: 'Agendar Container', exact: true }).dblclick()
    await expect(page.getByText('Container agendado. A configuração visual está congelada.', { exact: true })).toBeVisible()
    expect(await jobs()).toBe(4)
    const published = await sql([{ sql: 'SELECT count(*) n FROM publication_history', args: [] }]) as { n: number }[][]
    expect(published[0][0].n).toBe(0)
    expect(errors).toEqual([])
  } finally { await app.close() }
})

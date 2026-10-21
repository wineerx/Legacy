import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'
import { zonedToUtc } from '../../src/shared/schedule'
import { localDate, addDays } from '../../src/shared/agenda'

/** PR 08 in the real app: Containers (not jobs) in Day, Week, Month and Timeline, in the workspace zone. */
test('Calendário mostra Containers em Dia, Semana, Mês e Timeline', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-calendar-e2e-')), video = join(dir, 'fixture.mp4'), db = join(dir, 'data', 'legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', video])
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
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
    const meme = page.getByRole('article', { name: 'Container Meme' })
    await expect(meme).toContainText('Instagram · @qa.agenda')
    await expect(meme).toContainText('12 publicações')
    await expect(meme).toContainText('13:00 → 15:45')
    await expect(meme).toContainText('0/12')
    await expect(page.getByRole('article', { name: 'Rascunho noturno' })).toHaveAttribute('data-state', 'draft')
    mkdirSync('docs/screens/qa-calendar', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-calendar/dia.png' })
    await page.getByRole('button', { name: 'Semana', exact: true }).click()
    await expect(page.getByTestId('agenda-time-grid').getByRole('article', { name: 'Container Meme' })).toBeVisible()
    await page.screenshot({ path: 'docs/screens/qa-calendar/semana.png' })
    await page.getByRole('button', { name: 'Mês', exact: true }).click()
    await expect(page.getByTestId('agenda-month').getByRole('article', { name: 'Container Meme' })).toContainText('13:00 → 15:45')
    await page.screenshot({ path: 'docs/screens/qa-calendar/mes.png' })
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.getByTestId('agenda-timeline').getByRole('img', { name: /^Container Meme: / })).toBeVisible()
    await page.screenshot({ path: 'docs/screens/qa-calendar/timeline.png' })
    // Twelve jobs exist, but the calendar shows one entry for them.
    const jobs = await page.evaluate(async ws => { const r = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>; return r.ok ? r.data.length : -1 }, boot.id)
    expect(jobs).toBe(12)
    await page.getByRole('button', { name: 'Semana', exact: true }).click()
    await expect(page.getByTestId('agenda-time-grid').getByRole('article')).toHaveCount(2)

    // PR 09: the details Sheet, with whole-Container totals and agenda actions.
    await page.getByRole('button', { name: 'Abrir Container Meme', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Container Meme' })
    await expect(sheet).toContainText('Instagram · @qa.agenda')
    await expect(sheet.getByText('0 / 12', { exact: true })).toBeVisible()
    await expect(sheet.getByText('Vídeos · 12', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Pausar', exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Retomar', exact: true })).toBeVisible()
    const control = () => page.evaluate(async ws => { const r = await window.legacy.invoke('containers.query', { workspaceId: ws, states: ['scheduled', 'paused', 'in_progress'] }) as IpcResult<Outputs['containers.query']>; return r.ok ? r.data.items[0].controlState : 'error' }, boot.id)
    expect(await control()).toBe('paused')
    await sheet.getByRole('button', { name: 'Retomar', exact: true }).click()
    await expect(sheet.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    expect(await control()).toBe('active')
    await sheet.getByRole('button', { name: 'Reagendar', exact: true }).click()
    await expect(sheet.getByRole('region', { name: 'Janela do Container' })).toContainText('Dentro da janela')
    await page.screenshot({ path: 'docs/screens/qa-calendar/detalhes.png' })
    await sheet.getByRole('button', { name: 'Fechar detalhes', exact: true }).click()
    await page.getByRole('button', { name: 'Abrir Rascunho noturno', exact: true }).click()
    await page.getByRole('dialog', { name: 'Rascunho noturno' }).getByRole('button', { name: 'Editar', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Container em rascunho' })).toBeVisible()
    await expect(page.getByLabel('Nome do Container', { exact: true })).toHaveValue('Rascunho noturno')
    expect(errors).toEqual([])
  } finally { await app.close() }
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync }  from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('Configuração visual no Sheet → rascunho → revisão → snapshot congelado', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-container-visual-e2e-'))
  const video = join(dir, 'fixture.mp4'), png = join(dir, 'watermark.png')
  const ff = resolve('resources/bin/win32-x64/ffmpeg.exe')
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=360x640:rate=30:duration=3', '-c:v', 'libopenh264', video])
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=100x50', '-frames:v', '1', png])
  const original = readFileSync(video)
  const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('out/main/index.js'), '--user-data-dir=' + join(dir, 'chromium')], env: { ...process.env, LEGACY_DATA_DIR: join(dir, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible()
    const ws = await page.evaluate(async () => {
      const r = await window.legacy.invoke('app.bootstrap', {}) as IpcResult<Outputs['app.bootstrap']>
      if (!r.ok) throw Error('bootstrap'); return r.data.workspaces[0].id
    })
    await app.evaluate(({ safeStorage, app }, input) => {
      const require = process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const Database = require('better-sqlite3'), db = new Database(input.db)
      try {
        const put = db.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(input.ws, 'instagramAccount', JSON.stringify({ id: '123456', username: 'qa.destino', revision: 'qa-rev', validatedAt: new Date().toISOString() }))
        put.run(input.ws, 'secret.instagramToken', safeStorage.encryptString('qa-synthetic-token').toString('base64'))
        const insert = db.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,1000,360,640,'h264','none','{}',?)")
        db.transaction(() => { for (let n = 0; n < 1; n++) insert.run(`qa-${String(n).padStart(3, '0')}`, input.ws, `video-${String(n).padStart(3, '0')}.mp4`, input.video, `synthetic-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString()) })()
      } finally { db.close() }
    }, { ws, video, db: join(dir, 'data', 'legacy.sqlite') })
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByRole('button', { name: 'Selecionar página', exact: true }).click()
    await page.getByRole('button', { name: 'Criar novo Container', exact: true }).click()
    await page.getByLabel('Nome do Container', { exact: true }).fill('Visual QA')
    await page.getByRole('combobox', { name: 'Destino do Container' }).click()
    await page.getByRole('option', { name: 'Instagram · @qa.destino', exact: true }).click()
    await page.getByRole('button', { name: 'Configuração visual', exact: true }).click()
    await page.getByRole('switch', { name: 'Ativar marca d’água', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Salvar rascunho', exact: true })).toBeDisabled()
    await page.getByLabel('Imagem da marca d’água', { exact: true }).setInputFiles(png)
    await page.getByRole('combobox', { name: 'Posição da marca d’água' }).click()
    await page.getByRole('option', { name: 'Superior direito', exact: true }).click()
    await page.getByLabel('Tamanho da marca d’água (%)', { exact: true }).fill('20')
    await page.getByLabel('Opacidade da marca d’água (%)', { exact: true }).fill('50')
    await expect(page.getByTestId('visual-watermark')).toHaveCSS('opacity', '0.5')
    await expect(page.getByTestId('visual-watermark')).toHaveJSProperty('naturalWidth', 100)
    const geometry = await page.getByTestId('visual-watermark').evaluate(el => ({ left: el.style.left, top: el.style.top, width: el.style.width }))
    expect(parseFloat(geometry.left)).toBeCloseTo(281 / 360 * 100)
    expect(parseFloat(geometry.top)).toBeCloseTo(7 / 640 * 100)
    expect(parseFloat(geometry.width)).toBe(20)
    await page.getByRole('switch', { name: 'Ativar banner', exact: true }).click()
    await page.getByLabel('Imagem do banner', { exact: true }).setInputFiles(png)
    await page.getByLabel('Início do banner (s)', { exact: true }).fill('1')
    await page.getByLabel('Fim do banner (s)', { exact: true }).fill('2')
    await expect(page.getByTestId('visual-banner')).toHaveCount(0)
    await page.getByLabel('Prévia do rascunho', { exact: true }).evaluate((el: HTMLVideoElement) => { el.currentTime = 1.5 })
    await expect(page.getByTestId('visual-banner')).toBeVisible()
    await page.getByRole('switch', { name: 'Ativar capa', exact: true }).click()
    await page.getByLabel('Imagem da capa', { exact: true }).setInputFiles(png)
    await page.getByLabel('Prévia do rascunho', { exact: true }).evaluate((el: HTMLVideoElement) => { el.currentTime = 0 })
    await expect(page.getByTestId('visual-cover')).toBeVisible()
    mkdirSync('docs/screens/qa-containers', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-containers/configuracao-visual.png' })
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    const saved = await page.evaluate(async ws => {
      const r = await window.legacy.invoke('containers.query', { workspaceId: ws, state: 'draft' }) as IpcResult<Outputs['containers.query']>
      const jobs = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>
      if (!r.ok || !jobs.ok) throw Error('draft'); if (jobs.data.length) throw Error('Draft created jobs')
      return r.data.items[0]
    }, ws)
    expect(saved.visualSnapshot.watermark).toMatchObject({ enabled: true, position: 'top-right', scalePct: 20, opacityPct: 50 })
    expect(readFileSync(video)).toEqual(original)
    expect(readdirSync(join(dir, 'data'), { recursive: true }).filter(p => String(p).includes('processed'))).toEqual([])
    // Future fixture date keeps workers away from all external providers.
    await page.evaluate(async ({ ws, saved }) => {
      const future = new Date(Date.now() + 3 * 86400000); future.setSeconds(0, 0)
      const r = await window.legacy.invoke('containers.updateDraft', { workspaceId: ws, containerId: saved.id, expectedRevision: saved.revision, draft: { name: saved.name, destinationAccountId: saved.destinationAccountId, provider: saved.provider, accountRevision: saved.accountRevision, timeZone: saved.timeZone, plannedStartAt: future.toISOString(), intervalMin: 15, visualSnapshot: saved.visualSnapshot, items: [{ assetId: 'qa-000' }] } }) as IpcResult<Outputs['containers.updateDraft']>
      if (!r.ok) throw Error(JSON.stringify(r))
    }, { ws, saved })
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
    await page.getByRole('button', { name: /Visual QA/ }).click()
    await page.getByRole('button', { name: 'Configuração visual', exact: true }).click()
    await expect(page.getByLabel('Opacidade da marca d’água (%)', { exact: true })).toHaveValue('50')
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Agendar Container', exact: true }).dblclick()
    await expect(page.getByText('Container agendado. A configuração visual está congelada.', { exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Ativar marca d’água', exact: true })).toBeDisabled()
    const final = await page.evaluate(async ({ ws, saved }) => {
      const r = await window.legacy.invoke('containers.get', { workspaceId: ws, containerId: saved.id }) as IpcResult<Outputs['containers.get']>
      if (!r.ok) throw Error('get')
      const edit = await window.legacy.invoke('containers.updateDraft', { workspaceId: ws, containerId: saved.id, expectedRevision: r.data.container.revision, draft: { name: 'Attempt', visualSnapshot: { version: 1 } } }) as IpcResult<Outputs['containers.updateDraft']>
      const list = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>
      if (!list.ok) throw Error('jobs')
      await window.legacy.invoke('containers.cancel', { workspaceId: ws, containerId: saved.id, expectedRevision: r.data.container.revision })
      return { container: r.data.container, editOk: edit.ok, jobs: list.data }
    }, { ws, saved })
    expect(final.container.visualSnapshot).toEqual(saved.visualSnapshot)
    expect(final.editOk).toBe(false)
    expect(final.jobs).toHaveLength(1)
    expect(readFileSync(video)).toEqual(original)
  } finally { await app.close() }
})

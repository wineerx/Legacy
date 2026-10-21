import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('Biblioteca → Container rascunho → revisão: persistência, seleção, edição e zero jobs', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'legacy-container-drafts-'))
  const video = join(dir, 'fixture.mp4')
  // Fixture generation happens before opening any draft; no media preparation in the flow.
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=1', '-c:v', 'libopenh264', video])
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
        db.transaction(() => { for (let n = 0; n < 205; n++) insert.run(`qa-${String(n).padStart(3, '0')}`, input.ws, `video-${String(n).padStart(3, '0')}.mp4`, input.video, `synthetic-sha-${n}`, new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString()) })()
      } finally { db.close() }
    }, { ws, video, db: join(dir, 'data', 'legacy.sqlite') })
    await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await page.getByLabel('Buscar mídia', { exact: true }).fill('video')
    await page.getByRole('button', { name: 'Próxima página', exact: true }).click()
    await expect(page.getByText('61–120 de 205', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Selecionar página', exact: true }).click()
    await page.getByLabel('Quantidade Top N', { exact: true }).fill('3')
    await page.getByRole('button', { name: 'Selecionar Top N', exact: true }).click()
    await expect(page.getByText('3 selecionados', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Criar novo Container', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Container em rascunho', exact: true })
    await expect(editor.getByTestId('draft-video')).toHaveCount(3)
    await editor.getByLabel('Nome do Container', { exact: true }).fill('Lote QA rascunho')
    await editor.getByRole('combobox', { name: 'Destino do Container' }).click()
    await page.getByRole('option', { name: 'Instagram · @qa.destino', exact: true }).click()
    await editor.getByRole('button', { name: 'Visualizar video-204.mp4', exact: true }).click()
    await expect(page.getByLabel('Prévia do rascunho')).toHaveAttribute('src', /legacy-media:/)
    await page.getByRole('button', { name: 'Fechar prévia', exact: true }).click()
    await editor.getByRole('button', { name: 'Arrastar video-204.mp4', exact: true }).dragTo(editor.getByTestId('draft-video').nth(2))
    await expect(editor.getByTestId('draft-video').nth(2)).toHaveAttribute('data-asset-id', 'qa-204')
    await editor.getByRole('button', { name: 'Remover video-203.mp4', exact: true }).click()
    await editor.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).dblclick()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    mkdirSync('docs/screens/qa-containers', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-containers/revisao-rascunho.png' })
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await expect(page.getByLabel('Buscar mídia', { exact: true })).toHaveValue('video')
    await expect(page.getByText('61–120 de 205', { exact: true })).toBeVisible()
    await expect(page.getByText('3 selecionados', { exact: true })).toBeVisible()
    const first = await page.evaluate(async ws => {
      const r = await window.legacy.invoke('containers.query', { workspaceId: ws, state: 'draft' }) as IpcResult<Outputs['containers.query']>
      if (!r.ok || r.data.total !== 1) throw Error('Expected one draft'); return r.data.items[0]
    }, ws)
    expect(first).toMatchObject({ name: 'Lote QA rascunho', destinationAccountId: '123456', state: 'draft', scheduledAt: null, counts: { total: 2 } })
    // Add the same selection: one missing item appended, existing videos retained once.
    await page.getByRole('button', { name: 'Adicionar ao Container', exact: true }).click()
    await page.getByRole('button', { name: /Lote QA rascunho/ }).click()
    await expect(page.getByText('1 vídeo(s) adicionado(s); 2 já presente(s).', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
    await page.getByRole('button', { name: /Lote QA rascunho/ }).click()
    await expect(page.getByTestId('draft-video')).toHaveCount(3)
    await page.getByLabel('Nome do Container', { exact: true }).fill('Lote revisado')
    await page.getByRole('combobox', { name: 'Destino do Container' }).click()
    await page.getByRole('option', { name: 'Definir depois', exact: true }).click()
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    // Full pagination is part of the real renderer → IPC → SQLite flow.
    await page.getByLabel('Quantidade Top N', { exact: true }).fill('205')
    await page.getByRole('button', { name: 'Selecionar Top N', exact: true }).click()
    await expect(page.getByText('205 selecionados', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Criar novo Container', exact: true }).click()
    await page.getByLabel('Nome do Container', { exact: true }).fill('Grande rascunho')
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page.getByRole('button', { name: 'Containers em rascunho', exact: true }).click()
    await page.getByRole('button', { name: /Grande rascunho/ }).click()
    await expect(page.getByTestId('draft-video')).toHaveCount(205)
    await page.getByRole('button', { name: 'Remover video-000.mp4', exact: true }).click()
    await page.getByRole('button', { name: 'Revisar rascunho', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click()
    await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.', { exact: true })).toBeVisible()
    const result = await page.evaluate(async ws => {
      const r = await window.legacy.invoke('containers.query', { workspaceId: ws, state: 'draft' }) as IpcResult<Outputs['containers.query']>
      const jobs = await window.legacy.invoke('jobs.list', { workspaceId: ws }) as IpcResult<Outputs['jobs.list']>
      if (!r.ok || !jobs.ok) throw Error('Verification'); return { containers: r.data.items, jobs: jobs.data }
    }, ws)
    expect(result.jobs).toHaveLength(0)
    expect(result.containers.find(c => c.name === 'Grande rascunho')?.counts.total).toBe(204)
    expect(result.containers.find(c => c.name === 'Lote revisado')).toMatchObject({ destinationAccountId: null, provider: null, counts: { total: 3 } })
  } finally { await app.close() }
})

import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('publicação identificada, Biblioteca exata, balão, badges e exclusão confirmada', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-revisions-'))
  const app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: [
      resolve('out/main/index.js'),
      `--user-data-dir=${join(root, 'chromium')}`
    ],
    env: {
      ...process.env,
      LEGACY_DATA_DIR: join(root, 'data'),
      LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1',
      APIFY_TOKEN: ''
    }
  })
  try {
    const page = await app.firstWindow()
    await page
      .getByRole('button', { name: 'Entrar como visitante', exact: true })
      .click()
    const ws = await page.evaluate(async () => {
      const r = (await window.legacy.invoke('app.bootstrap', {})) as IpcResult<
        Outputs['app.bootstrap']
      >
      if (!r.ok) throw Error('bootstrap')
      return r.data.workspaces[0].id
    })
    await app.evaluate(
      ({ app }, input) => {
        const req = process
          .getBuiltinModule('node:module')!
          .createRequire(`${app.getAppPath()}/package.json`)
        const db = new (req('better-sqlite3'))(input.path)
        try {
          const now = new Date().toISOString()
          for (const [id, name] of [
            ['asset-a', 'Publicado A.mp4'],
            ['asset-b', 'Outro B.mp4']
          ])
            db.prepare(
              'INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,validation_json,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'
            ).run(
              id,
              input.ws,
              'pc',
              name,
              input.path + '.mp4',
              id,
              1000,
              2000,
              1080,
              1920,
              'h264',
              '{}',
              now
            )
          db.prepare(
            'INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
          ).run(
            'published-a',
            input.ws,
            'publish_instagram',
            JSON.stringify({
              localAssetId: 'asset-a',
              accountId: '123',
              postId: 'source-a'
            }),
            'Publicação QA',
            'done',
            now,
            JSON.stringify({ mediaId: '456', confirmedPublished: true }),
            now,
            now
          )
          db.prepare(
            'INSERT INTO publication_history(job_id,workspace_id,account_id,username,post_id,asset_sha,media_id,provenance_json,published_at) VALUES(?,?,?,?,?,?,?,?,?)'
          ).run(
            'published-a',
            input.ws,
            '123',
            'qa.account',
            'source-a',
            'asset-a',
            '456',
            JSON.stringify({ sourceName: 'Publicado A.mp4' }),
            now
          )
          const notification = db.prepare(
            'INSERT INTO notifications(id,workspace_id,kind,title,body,created_at) VALUES(?,?,?,?,?,?)'
          )
          for (let i = 0; i < 120; i++)
            notification.run(
              'notice-' + i,
              input.ws,
              'info',
              'Aviso ' + i,
              'Mensagem QA',
              now
            )
        } finally {
          db.close()
        }
      },
      { path: join(root, 'data', 'legacy.sqlite'), ws }
    )
    await page.getByRole('link', { name: 'Fila', exact: true }).click()
    const published = page.getByRole('article', {
      name: 'Publicação QA',
      exact: true
    })
    await expect(published).toContainText('Publicado A.mp4')
    await published
      .getByRole('button', { name: 'Andamento e tentativas' })
      .click()
    await expect(
      published.getByText('Publicação confirmada pela API.', { exact: true })
    ).toHaveClass(/text-ok/)
    await published
      .getByRole('button', { name: 'Ver vídeo na Biblioteca' })
      .click()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article')).toContainText('Publicado A.mp4')
    await page.getByRole('button', { name: 'Limpar filtro do vídeo' }).click()
    await expect(page.getByRole('article')).toHaveCount(2)
    await page
      .getByRole('button', { name: 'Recolher menu', exact: true })
      .click()
    const notices = page.getByRole('link', {
      name: /Notificações, 120 não lidas/
    })
    await expect(notices).toContainText('99+')
    const bounds = await notices.boundingBox(),
      icon = await notices.locator('svg').boundingBox(),
      badge = await notices.locator('span').boundingBox(),
      nav = await page
        .getByRole('navigation', { name: 'Principal' })
        .boundingBox()
    expect(icon!.width).toBe(16)
    expect(badge!.x + badge!.width).toBeLessThanOrEqual(nav!.x + nav!.width)
    expect(bounds!.height).toBeGreaterThanOrEqual(32)
    await page
      .getByRole('button', { name: 'Interagir com o mascote Legacy' })
      .click()
    await expect(
      page.getByRole('progressbar', { name: 'Tarefas concluídas' })
    ).toHaveAttribute('aria-valuenow', '100')
    mkdirSync('docs/screens/qa-revisions', { recursive: true })
    await page.screenshot({
      path: 'docs/screens/qa-revisions/sidebar-balao.png'
    })
    await page.keyboard.press('Escape')
    await notices.click()
    await page
      .getByRole('button', { name: 'Selecionar notificações', exact: true })
      .click()
    await page
      .getByRole('checkbox', { name: 'Selecionar todas', exact: true })
      .check()
    await page
      .getByRole('button', { name: 'Excluir selecionadas (120)', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Excluir notificações?' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(
      page.getByRole('link', { name: /Notificações, 120/ })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Excluir todas', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Confirmar exclusão', exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: 'Notificações, 0 não lidas' })
    ).toContainText('0')
    const selectAll = page.getByRole('checkbox', { name: 'Selecionar todas', exact: true })
    await expect(selectAll).toBeDisabled()
    expect((await selectAll.locator('..').boundingBox())!.height).toBe(28)
    await page.screenshot({ path: 'docs/screens/qa-revisions/selecionar-todas.png' })
    const profile = await page.evaluate(
      async (ws) =>
        window.legacy.invoke('profiles.add', {
          workspaceId: ws,
          url: 'https://www.tiktok.com/@qa.original'
        }),
      ws
    )
    expect((profile as IpcResult<Outputs['profiles.add']>).ok).toBe(true)
    await page.getByRole('link', { name: 'Perfis', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Perfis tiktok' })
    ).toContainText('TikTok')
    const row = page.getByRole('button', { name: '@qa.original', exact: true })
    await expect(row).toBeVisible()
    await expect(row.locator('.rounded-full')).toHaveCount(1)
  } finally {
    await app.close()
  }
})

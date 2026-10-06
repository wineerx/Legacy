import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

async function launch(root: string) {
  return electron.launch({
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
}
async function database(
  app: ElectronApplication,
  root: string,
  sql: string,
  parameters: unknown[] = []
) {
  return app.evaluate(
    ({ app }, input) => {
      const req = process
        .getBuiltinModule('node:module')!
        .createRequire(`${app.getAppPath()}/package.json`)
      const db = new (req('better-sqlite3'))(input.path)
      try {
        const statement = db.prepare(input.sql)
        return statement.reader
          ? statement.all(...input.parameters)
          : statement.run(...input.parameters)
      } finally {
        db.close()
      }
    },
    { path: join(root, 'data', 'legacy.sqlite'), sql, parameters }
  )
}
const insertJob =
  'INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,max_attempts,result_json,created_at,updated_at,lease_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'

test('sessão local bloqueia tarefas antes da entrada, pausa ao sair e reinicia deslogada', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-guest-'))
  let app = await launch(root)
  try {
    let page = await app.firstWindow()
    await expect(
      page.getByRole('heading', { name: 'Entrar no Legacy' })
    ).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.legacy-mascot')).toHaveAttribute(
      'data-animated',
      'false'
    )
    mkdirSync('docs/screens/qa-ui-guest', { recursive: true })
    await page.screenshot({ path: 'docs/screens/qa-ui-guest/entrada.png' })
    const rows = (await database(app, root, 'SELECT id FROM workspaces')) as {
      id: string
    }[]
    const ws = rows[0].id,
      now = new Date().toISOString()
    await database(app, root, insertJob, [
      'guest-paused',
      ws,
      'make_thumbnail',
      JSON.stringify({ assetId: 'missing-test-asset' }),
      'Tarefa de teste',
      'queued',
      now,
      1,
      null,
      now,
      now,
      null
    ])
    const blocked = await page.evaluate(
      async (ws) => window.legacy.invoke('jobs.list', { workspaceId: ws }),
      ws
    )
    expect(blocked).toMatchObject({ ok: false })
    await page.waitForTimeout(1500)
    expect(
      await database(app, root, 'SELECT state,attempts FROM jobs WHERE id=?', [
        'guest-paused'
      ])
    ).toEqual([{ state: 'queued', attempts: 0 }])
    await page.getByRole('button', { name: 'Entrar como visitante' }).click()
    await expect(
      page.getByRole('heading', { name: 'Visão geral', exact: true })
    ).toBeVisible()
    await expect
      .poll(
        async () =>
          (
            (await database(app, root, 'SELECT state FROM jobs WHERE id=?', [
              'guest-paused'
            ])) as { state: string }[]
          )[0].state
      )
      .toBe('failed')
    await page.getByRole('button', { name: 'Menu do usuário' }).click()
    await expect(page.getByText('guest@legacy.com').first()).toBeVisible()
    await page.getByRole('button', { name: 'Sair do Legacy' }).click()
    await expect(
      page.getByRole('heading', { name: 'Entrar no Legacy' })
    ).toBeVisible()
    await database(app, root, insertJob, [
      'guest-after-exit',
      ws,
      'make_thumbnail',
      '{}',
      'Outra tarefa',
      'queued',
      now,
      1,
      null,
      now,
      now,
      null
    ])
    await page.waitForTimeout(1500)
    expect(
      await database(app, root, 'SELECT state,attempts FROM jobs WHERE id=?', [
        'guest-after-exit'
      ])
    ).toEqual([{ state: 'queued', attempts: 0 }])
    await app.close()
    app = await launch(root)
    page = await app.firstWindow()
    await expect(
      page.getByRole('heading', { name: 'Entrar no Legacy' })
    ).toBeVisible()
    await page.waitForTimeout(1200)
    expect(
      await database(app, root, 'SELECT state FROM jobs WHERE id=?', [
        'guest-after-exit'
      ])
    ).toEqual([{ state: 'queued' }])
  } finally {
    await app.close()
  }
})

test('progresso persistido reabre, controles funcionam e publicação confirmada celebra uma vez', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-progress-ui-'))
  const app = await launch(root)
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Entrar como visitante' }).click()
    await expect(
      page.getByRole('heading', { name: 'Visão geral', exact: true })
    ).toBeVisible()
    const rows = (await database(app, root, 'SELECT id FROM workspaces')) as {
      id: string
    }[]
    const ws = rows[0].id,
      now = new Date().toISOString(),
      future = new Date(Date.now() + 3600000).toISOString()
    await page.evaluate(
      async (ws) =>
        window.legacy.invoke('profiles.add', {
          workspaceId: ws,
          url: 'instagram.com/qa.progress'
        }),
      ws
    )
    const profiles = (await database(
      app,
      root,
      'SELECT id FROM tracked_profiles WHERE workspace_id=?',
      [ws]
    )) as { id: string }[]
    const progress = {
      phase: 'importing',
      processed: 32,
      total: 80,
      imported: 30,
      skipped: 2,
      previewFailures: 1,
      percent: 40
    }
    await database(app, root, insertJob, [
      'qa-progress',
      ws,
      'fetch_profile',
      JSON.stringify({
        profileId: profiles[0].id,
        discovery: true,
        limit: 100
      }),
      'Importar perfil',
      'running',
      now,
      1,
      JSON.stringify({ runId: 'qaRun', progress }),
      now,
      now,
      future
    ])
    await page.getByRole('button', { name: 'Menu do usuário' }).click()
    await page.getByRole('button', { name: 'Editar perfil local' }).click()
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('∝winner')
    await page.getByLabel('Foto do perfil').setInputFiles('docs/screens/qa-ui-guest/entrada.png')
    await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Menu do usuário' })).toContainText('∝winner')
    await page.getByRole('button', { name: 'Menu do usuário' }).click()
    await page.getByRole('button', { name: 'Editar perfil local' }).click()
    await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Não salvar')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Menu do usuário' })).toContainText('∝winner')
    await page.getByRole('link', { name: 'Perfis', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Instagram', exact: true })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Importar perfil', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Andamento da importação' })
    ).toContainText('32 de 80 posts processados · 40%')
    await page.screenshot({ path: 'docs/screens/qa-ui-guest/importacao.png' })
    await page.getByRole('button', { name: 'Fechar', exact: true }).click()
    await page
      .getByRole('button', { name: 'Importar perfil', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText(
      '30 importados · 2 ignorados'
    )
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: 'Aumentar Limite de posts para analisar' })
      .click()
    await expect(
      page.getByRole('spinbutton', { name: 'Limite de posts para analisar' })
    ).toHaveValue('101')
    await database(
      app,
      root,
      'UPDATE jobs SET state=?,result_json=? WHERE id=?',
      [
        'done',
        JSON.stringify({
          runId: 'qaRun',
          progress: {
            ...progress,
            phase: 'done',
            processed: 80,
            imported: 78,
            percent: 100
          }
        }),
        'qa-progress'
      ]
    )
    await page
      .getByRole('button', { name: 'Importar perfil', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toContainText('Grade carregada')
    await page.keyboard.press('Escape')
    expect(
      await database(
        app,
        root,
        "SELECT count(*) AS n FROM jobs WHERE type='download_reel'"
      )
    ).toEqual([{ n: 0 }])
    await database(
      app,
      root,
      'INSERT INTO publication_history(job_id,workspace_id,account_id,username,post_id,provenance_json,published_at) VALUES(?,?,?,?,?,?,?)',
      ['qa-confirmed', ws, '123', 'qa.destino', 'test-post', '{}', now]
    )
    await expect(
      page.getByText('Reel publicado em @qa.destino', { exact: true })
    ).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.publication-confetti')).toHaveCount(1)
    await expect(page.locator('.publication-confetti')).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Visão geral', exact: true })
    ).toBeVisible()
    await page.waitForTimeout(5200)
    await expect(
      page.getByText('Reel publicado em @qa.destino', { exact: true })
    ).toHaveCount(0)
  } finally {
    await app.close()
  }
})

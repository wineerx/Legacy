import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openSettings } from './helpers'

test('identidade Legacy, personalização persistente e redução de movimento', async () => {
  const root = mkdtempSync(join(tmpdir(), 'legacy-brand-'))
  const packaged = process.env.LEGACY_BRAND_EXECUTABLE
  const app = await electron.launch({
    executablePath: packaged ? resolve(packaged) : resolve('node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [resolve('out/main/index.js')]), `--user-data-dir=${join(root, 'session')}`],
    env: { ...process.env, APIFY_TOKEN: '', LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', LEGACY_DATA_DIR: join(root, 'data') },
  })
  try {
    const page = await app.firstWindow()
  await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.getByRole('heading', { name: 'Grandes ideias começam aqui.' })).toBeVisible()
    const mascotButton = page.getByRole('button', { name: 'Interagir com o mascote Legacy' })
    await expect(mascotButton).toBeVisible()
    await expect(mascotButton.locator('svg')).toHaveCount(1)
    await mascotButton.click()
    await expect(page.getByRole('dialog', { name: 'Status da fila' })).toContainText('0 em execução')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Status da fila' })).toHaveCount(0)
    const hero = page.locator('.brand-welcome .legacy-mascot')
    await expect(hero).toHaveAttribute('data-animated', 'true')
    await hero.hover()
    await expect(hero).toHaveAttribute('data-visible', 'true')
    const bounds = await hero.boundingBox()
    await page.mouse.move(bounds!.x + bounds!.width * .8, bounds!.y + bounds!.height * .3)
    await expect.poll(() => hero.evaluate(el => el.style.getPropertyValue('--look-x'))).not.toBe('0')
    await page.getByRole('heading', { name: 'Visão geral', exact: true }).click()
    await expect(hero).toHaveAttribute('data-state', 'idle')
    await page.screenshot({ path: 'docs/screens/brand/overview.png' })
    await openSettings(page)
    const panel = page.getByRole('region', { name: 'O seu Legacy.' })
    await panel.scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Visual: Coroa' }).click()
    await page.getByRole('button', { name: 'Comemorando', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Legacy: Comemorando' })).toBeVisible()
    await page.getByRole('switch', { name: 'Animações do mascote' }).click()
    await expect(page.getByRole('img', { name: 'Legacy: Comemorando' })).toHaveAttribute('data-animated', 'false')
    await page.reload()
    await openSettings(page)
    await expect(page.getByRole('button', { name: 'Visual: Coroa' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('switch', { name: 'Animações do mascote' })).not.toBeChecked()
    await page.getByRole('button', { name: 'Visual: Original' }).click()
    await page.getByRole('switch', { name: 'Animações do mascote' }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const animation = await page.locator('.brand-stage .mascot-float').evaluate(el => getComputedStyle(el).animationName)
    expect(animation).toBe('none')
    await expect(page.locator('.brand-stage .legacy-mascot')).toHaveAttribute('data-animated', 'false')
    await panel.screenshot({ path: 'docs/screens/brand/personalidade.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700))
    await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.getByRole('button', { name: 'Recolher menu' }).click()
    await page.getByRole('link', { name: 'Visão geral' }).click()
    await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible()

    // Fixture rows only in this test's isolated database; renderer, IPC and queries remain real.
    const changeJob = async (state: string, type = 'download_reel', error: string | null = null) => {
      await app.evaluate(({ app, BrowserWindow }, input) => {
        const req = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/package.json`)
        const Database = req('better-sqlite3')
        const db = new Database(`${input.root}/data/legacy.sqlite`)
        const ws = db.prepare('SELECT id FROM workspaces LIMIT 1').get().id
        const now = new Date().toISOString()
        const future = new Date(Date.now() + 3600000).toISOString()
        db.prepare('INSERT INTO jobs (id,workspace_id,type,payload_json,label,state,run_at,lease_until,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,type=excluded.type,last_error=excluded.last_error,updated_at=excluded.updated_at').run('brand-fixture', ws, input.type, '{}', 'Vídeo de teste', input.state, future, future, input.error, now, now)
        db.close()
        BrowserWindow.getAllWindows()[0].webContents.send('jobs.changed', { workspaceId: ws, jobId: 'brand-fixture', state: input.state })
      }, { root, state, type, error })
    }
    await changeJob('queued', 'publish_instagram')
    await expect(hero).toHaveAttribute('data-state', 'idle')
    await changeJob('running', 'fetch_profile')
    await expect(hero).toHaveAttribute('data-state', 'searching')
    await expect(mascotButton.locator('svg')).toHaveAttribute('data-state', 'searching')
    await changeJob('running', 'download_reel')
    await expect(hero).toHaveAttribute('data-state', 'downloading')
    await changeJob('running', 'publish_instagram')
    await expect(hero).toHaveAttribute('data-state', 'publishing')
    await changeJob('done')
    await expect(hero).toHaveAttribute('data-state', 'finished')
    await expect(hero).toHaveAttribute('data-state', 'idle')
    await changeJob('queued', 'publish_instagram', 'HTTP 429: limite temporário da plataforma.')
    await expect(hero).toHaveAttribute('data-state', 'rate_limit')
    await expect(page.locator('.brand-live-status')).toContainText('Próxima tentativa às')
    await changeJob('failed', 'publish_instagram', 'Token Instagram inválido.')
    await expect(hero).toHaveAttribute('data-state', 'error')
    await expect(page.locator('.brand-live-status')).toContainText('Token Instagram inválido.')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
    await page.getByRole('button', { name: 'Expandir menu' }).click()
    await page.locator('.brand-welcome').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'docs/screens/brand/processor-error.png' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    await expect(hero).toHaveAttribute('data-animated', 'false')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    await expect(hero).toHaveAttribute('data-animated', 'true')
  } finally { await app.close() }
})

// Runs the packaged application with an isolated, empty profile; never publishes.
const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-packaged-smoke-'))
  const env = { ...process.env, LEGACY_DATA_DIR: path.join(root, 'data'), LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', APIFY_TOKEN: '' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.LEGACY_PERF_DEBUG
  const executablePath = path.resolve('dist/win-unpacked/Legacy.exe')
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + path.join(root, 'chromium')], env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Entrar como visitante', exact: true }).click()
    const navigation = []
    for (const name of ['Biblioteca', 'Perfis', 'Criar postagem', 'Fila']) {
      const start = performance.now()
      await page.getByRole('link', { name, exact: true }).click()
      await page.waitForFunction(name => document.querySelector('a[aria-current="page"]')?.textContent?.includes(name), name)
      navigation.push({ name, ms: performance.now() - start })
    }
    const productionDebugDisabled = await page.evaluate(() => typeof window.legacy.debugListenerCounts === 'undefined')
    const runtime = await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json')
      const DB = require('better-sqlite3')
      const db = new DB(process.env.LEGACY_DATA_DIR + '/legacy.sqlite', { readonly: true })
      const indexes = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND (tbl_name='jobs' OR tbl_name='media_assets')").all()
      db.close()
      return { version: app.getVersion(), appPath: app.getAppPath(), indexes, metrics: app.getAppMetrics() }
    })
    if (!productionDebugDisabled || runtime.version !== '0.7.5') throw new Error('Production package assertion failed')
    if (!runtime.indexes.some(x => x.sql?.includes('"workspace_id","state"')) && !runtime.indexes.some(x => /workspace_id.*state/.test(x.sql || ''))) throw new Error('Jobs index missing')
    const result = { timestamp: new Date().toISOString(), executablePath, isolatedProfile: root, productionDebugDisabled, navigation, ...runtime, result: 'passed', externalPosts: 0 }
    fs.writeFileSync(path.resolve('docs/benchmarks/regression/packaged-smoke.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ result: result.result, version: runtime.version, productionDebugDisabled, navigation, indexCount: runtime.indexes.length, processes: runtime.metrics.map(x => x.type) }))
  } finally { await app.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

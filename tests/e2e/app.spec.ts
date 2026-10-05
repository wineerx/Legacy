import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

let app: ElectronApplication
let page: Page
const dataDir = mkdtempSync(join(tmpdir(), 'legacy-e2e-'))
const video = join(dataDir, 'clip.mp4')

test.beforeAll(async () => {
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=4', '-c:v', 'libopenh264', video])
  app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: [resolve('out/main/index.js')],
    env: { ...process.env, APIFY_TOKEN: '', LEGACY_DISABLE_DESKTOP_NOTIFICATIONS: '1', LEGACY_DATA_DIR: join(dataDir, 'data') }
  })
  page = await app.firstWindow()
})
test.afterAll(async () => { await app.close() })

test('abre na visão geral com checklist', async () => {
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible()
  await expect(page.getByText('Conectar Instagram')).toBeVisible()
  await expect(page.getByText('Processador ativo')).toBeVisible()
})

test('importa vídeo e mostra card 9:16 com miniatura', async () => {
  await page.getByRole('link', { name: 'Biblioteca' }).click()
  const workspaceId = await page.evaluate(async () => {
    const r = (await window.legacy.invoke('app.bootstrap', {})) as { data: { workspaces: { id: string }[] } }
    return r.data.workspaces[0].id
  })
  await page.evaluate(async ([ws, p]) => window.legacy.invoke('library.importPaths', { workspaceId: ws, paths: [p] }), [workspaceId, video] as const)
  const card = page.getByRole('article', { name: 'clip.mp4' })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.locator('img')).toBeVisible({ timeout: 30_000 })
  await expect(card.getByLabel('Visualizações: indisponível')).toBeVisible()
})

test('perfil por link e reel guardado como referência', async () => {
  await page.getByRole('link', { name: 'Perfis' }).click()
  await page.getByLabel('Link do perfil').fill('instagram.com/perfil.teste')
  await page.getByRole('button', { name: 'Adicionar perfil' }).click()
  await expect(page.getByRole('heading', { name: '@perfil.teste' })).toBeVisible()
  await expect(page.getByText(/Busca e download de reels públicos via Apify/)).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar link de reel' }).click()
  await page.getByLabel('Link do reel').fill('https://www.instagram.com/reel/ABCDE12345/')
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(page.getByLabel('Visualizações: indisponível')).toBeVisible()
})

test('clique no card abre player interno e referência fica dentro do Legacy', async () => {
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir clip.mp4', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Visualizar no Legacy' })).toBeVisible()
  const source = await page.getByLabel('Player de vídeo').getAttribute('src')
  expect(source).toContain('legacy-media://file/')
  await page.getByRole('button', { name: 'Fechar player' }).click()
  await page.getByRole('link', { name: 'Perfis', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir Vídeo sem legenda', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Visualizar no Legacy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver origem no Instagram' })).toBeVisible()
  await page.getByRole('button', { name: 'Fechar player' }).click()
})

test('fila mostra a miniatura concluída', async () => {
  await page.getByRole('link', { name: 'Fila' }).click()
  await expect(page.getByText('Concluída').first()).toBeVisible({ timeout: 30_000 })
})

test('captura screenshots das telas principais', async () => {
  for (const [nome, rotulo] of [['visao-geral', 'Visão geral'], ['biblioteca', 'Biblioteca'], ['perfis', 'Perfis'], ['fila', 'Fila'], ['configuracoes', 'Configurações']] as const) {
    await page.getByRole('link', { name: rotulo }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `docs/screens/qa-0.4/${nome}.png` })
  }
})

test('configura pasta externa, importa e preserva miniatura após restaurar padrão', async () => {
  const folder = join(dataDir, 'armazenamento-alternativo')
  mkdirSync(folder)
  // Only the native picker is stubbed; IPC, SQLite, import, worker and protocol are real.
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, folder)
  await page.getByRole('link', { name: 'Configurações' }).click()
  await page.getByRole('button', { name: 'Alterar pasta dos vídeos' }).click()
  await expect(page.getByText(/armazenamento-alternativo/).first()).toBeVisible()
  const secondVideo = join(dataDir, 'outro.mp4')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=2', '-c:v', 'libopenh264', secondVideo])
  const result = await page.evaluate(async (source) => {
    const boot = await window.legacy.invoke('app.bootstrap', {}) as { data: { workspaces: { id: string }[] } }
    const workspaceId = boot.data.workspaces[0].id
    const storage = await window.legacy.invoke('storage.get', { workspaceId }) as { data: { path: string } }
    const imported = await window.legacy.invoke('library.importPaths', { workspaceId, paths: [source] }) as { data: { assetId: string }[] }
    return { path: storage.data.path, assetId: imported.data[0].assetId }
  }, secondVideo)
  expect(existsSync(join(result.path, result.assetId, 'original.mp4'))).toBe(true)
  await page.getByRole('button', { name: 'Restaurar pasta padrão' }).click()
  await expect(page.getByRole('button', { name: 'Restaurar pasta padrão' })).toBeDisabled()
  await page.getByRole('link', { name: 'Biblioteca' }).click()
  await expect(page.getByRole('article', { name: 'outro.mp4' }).locator('img')).toBeVisible({ timeout: 30000 })
})

test('download explica token ausente sem executar chamada externa', async () => {
  await page.getByRole('link', { name: 'Perfis' }).click()
  await page.getByRole('button', { name: 'Baixar vídeos do perfil' }).click()
  await expect(page.getByText(/Cadastre a chave Apify/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Buscar e baixar' })).toBeDisabled()
  await page.screenshot({ path: 'docs/screens/qa-0.4/download-perfil.png' })
  await page.getByRole('button', { name: 'Fechar', exact: true }).first().click()
})

test('configura chave Apify protegida e mantém webhook desativado', async () => {
  await page.getByRole('link', { name: 'Visão geral' }).click()
  await expect(page.getByRole('heading', { name: 'Métricas dos perfis' })).toBeVisible()
  await page.getByRole('button', { name: 'Configurar Apify' }).click()
  await page.getByLabel('Chave da API Apify').fill('apify_api_e2e_test')
  await page.getByRole('button', { name: 'Salvar chave' }).click()
  await expect(page.getByRole('button', { name: 'Testar chave salva' })).toBeEnabled()
  await expect(page.getByLabel('Chave da API Apify')).toHaveValue('')
  await page.getByRole('button', { name: 'Fechar', exact: true }).first().click()
  const state = await page.evaluate(async () => {
    const boot = await window.legacy.invoke('app.bootstrap', {}) as { data: { workspaces: { id: string }[] } }
    return window.legacy.invoke('integrations.get', { workspaceId: boot.data.workspaces[0].id }) as Promise<{ data: { apify: { configured: boolean }; webhook: { enabled: boolean } } }>
  })
  expect(state.data.apify.configured).toBe(true)
  expect(state.data.webhook.enabled).toBe(false)
  expect(JSON.stringify(state)).not.toContain('apify_api_e2e_test')
  await page.getByRole('button', { name: 'Configurar webhooks' }).click()
  await expect(page.getByRole('switch', { name: 'Ativar envios de webhook' })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Enviar evento de teste' })).toBeDisabled()
  await page.screenshot({ path: 'docs/screens/qa-0.4/webhooks.png' })
  await page.getByRole('button', { name: 'Fechar', exact: true }).first().click()
})

test('tour navega, mantém foco, pausa com Escape e permite retomar', async () => {
  await page.getByRole('link', { name: 'Tutoriais' }).click()
  await page.getByRole('button', { name: 'Iniciar tour do Legacy' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Seu painel de operação' })).toBeVisible()
  expect(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true)
  await page.screenshot({ path: 'docs/screens/qa-0.4/tutorial-tour.png' })
  await dialog.getByRole('button', { name: 'Próximo' }).click()
  await expect(dialog.getByRole('heading', { name: 'Prepare as APIs' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Próximo' }).click()
  await expect(dialog.getByRole('heading', { name: 'Adicione um perfil' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByRole('link', { name: 'Tutoriais' }).click()
  await page.getByRole('button', { name: 'Retomar tour do Legacy' }).click()
  await expect(dialog.getByRole('heading', { name: 'Adicione um perfil' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Pausar tutorial' }).click()
})

test('tutorial salva plano e referências e mostra ranking sem resultados fictícios', async () => {
  await page.getByRole('link', { name: 'Tutoriais' }).click()
  await page.getByLabel('Tema do perfil').fill('Curiosidades explicadas')
  await page.getByLabel('Bio planejada').fill('Curiosidades com contexto e fontes')
  await page.getByRole('button', { name: 'Salvar plano de perfil' }).click()
  await expect(page.getByText('Plano de perfil salvo')).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar referência' }).first().click()
  await expect(page.getByText('Referência adicionada aos Perfis')).toBeVisible()
  await page.getByRole('button', { name: 'Reels em destaque' }).click()
  await expect(page.getByText(/Ainda não há legendas com métricas disponíveis/)).toBeVisible()
  await page.screenshot({ path: 'docs/screens/qa-0.4/tutorial-guia.png', fullPage: true })
  await page.getByRole('link', { name: 'Perfis' }).click()
  await expect(page.getByRole('button', { name: '@peter.memes7', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Tutoriais' }).click()
  await expect(page.getByLabel('Tema do perfil')).toHaveValue('Curiosidades explicadas')
})

test('modelos horizontais preenchem legenda base do editor', async () => {
  await page.getByRole('link', { name: 'Biblioteca' }).click()
  await page.getByRole('checkbox', { name: 'Selecionar clip.mp4' }).check()
  await page.getByRole('button', { name: 'Preparar lote', exact: true }).click()
  await page.getByRole('button', { name: 'Usar modelo', exact: true }).first().click()
  await expect(page.getByLabel('Legenda base')).toHaveValue(/Qual parte mais te representa/)
})

test('telas cabem em 800, 1024 e 1440 pixels sem overflow da janela', async () => {
  for (const width of [800, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const label of ['Perfis', 'Biblioteca', 'Criar postagem', 'Visão geral', 'Fila', 'Configurações', 'Tutoriais', 'Contas', 'Notificações', 'Desafios e conquistas']) {
      await page.getByRole('link', { name: label, exact: true }).click()
      await page.waitForTimeout(250)
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')!
        return { document: document.documentElement.scrollWidth - window.innerWidth, main: main.scrollWidth - main.clientWidth }
      })
      if (overflow.document || overflow.main) console.log(await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > window.innerWidth).map(el => ({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,text:el.textContent?.slice(0,90),position:getComputedStyle(el).position,overflow:getComputedStyle(el).overflow,transform:getComputedStyle(el).transform})).slice(-12)))
      expect(overflow, `${label} em ${width}px`).toEqual({ document: 0, main: 0 })
    }
  }
})

test('desafios têm progresso real e filtros avançados recolhem', async () => {
  await page.getByRole('link', { name: 'Desafios e conquistas', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ofensiva diária' })).toBeVisible()
  await expect(page.getByText('Sua primeira publicação confirmada inicia a ofensiva.')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(8)
  await page.screenshot({ path: 'docs/screens/qa-0.4/desafios-0.4.png' })
  await page.evaluate(async () => { const boot = await window.legacy.invoke('app.bootstrap', {}) as { data: { workspaces: { id: string }[] } }; await window.legacy.invoke('profiles.add', { workspaceId: boot.data.workspaces[0].id, url: 'instagram.com/qa.filters' }) })
  await page.getByRole('link', { name: 'Perfis', exact: true }).click()
  await expect(page.getByLabel('Mínimo de views')).toBeHidden()
  await page.getByText('Filtros avançados', { exact: true }).click()
  await expect(page.getByLabel('Mínimo de views')).toBeVisible()
  await page.getByText('Filtros avançados', { exact: true }).click()
})

test('card tem métricas horizontais e fila permite ver arquivo e origem', async () => {
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).click()
  await page.evaluate(async (path) => { const boot = await window.legacy.invoke('app.bootstrap', {}) as { data: { workspaces: { id: string }[] } }; await window.legacy.invoke('library.importPaths', { workspaceId: boot.data.workspaces[0].id, paths: [path] }) }, video)
  const metrics = page.getByTestId('card-metrics').first()
  await expect(metrics).toBeVisible()
  const ys = await metrics.locator('[role="img"]').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().top)))
  expect(new Set(ys).size).toBe(1)
  await page.getByRole('link', { name: 'Fila', exact: true }).click()
  await page.getByRole('button', { name: 'Ver tarefa' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir arquivo', exact: true })).toBeVisible()
  await page.screenshot({ path: 'docs/screens/qa-0.4/tarefa-detalhes.png' })
  await page.keyboard.press('Escape')
})

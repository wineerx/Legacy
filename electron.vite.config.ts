import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const appVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string
const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const buildTime = new Date().toISOString()
const buildDefine = {
  'process.env.LEGACY_BUILD_COMMIT': JSON.stringify(buildCommit),
  'process.env.LEGACY_BUILD_TIME': JSON.stringify(buildTime),
  'process.env.LEGACY_APP_VERSION': JSON.stringify(appVersion)
}

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

export default defineConfig({
  main: {
    define: buildDefine,
    plugins: [{ name: 'legacy-build-identity', writeBundle() {
      mkdirSync(resolve('out/main'), { recursive: true })
      writeFileSync(resolve('out/main/build-info.json'), JSON.stringify({ version: appVersion, commit: buildCommit, builtAt: buildTime }, null, 2) + '\n')
    } }],
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/main/worker/worker.ts') }
      }
    }
  },
  preload: {
    define: buildDefine,
    resolve: { alias },
    build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { resolve: { alias }, plugins: [react(), tailwindcss()] }
})

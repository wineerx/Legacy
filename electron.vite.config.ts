import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/main/worker/worker.ts') }
      }
    }
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { resolve: { alias }, plugins: [react(), tailwindcss()] }
})

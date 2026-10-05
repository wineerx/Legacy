import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }

export default defineConfig({
  test: {
    projects: [
      { resolve: { alias }, test: { name: 'node', environment: 'node', include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'], testTimeout: 30000 } },
      { resolve: { alias }, test: { name: 'dom', environment: 'jsdom', globals: true, include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'], setupFiles: ['src/renderer/test-setup.ts'] } }
    ]
  }
})

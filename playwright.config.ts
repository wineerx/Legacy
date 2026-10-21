import { defineConfig } from '@playwright/test'
// Every launched app inherits process.env: Instagram requests (publish, status, quota) are refused locally.
process.env.LEGACY_PROVIDER_NETWORK ??= 'off'
export default defineConfig({ testDir: 'tests/e2e', timeout: 90_000, workers: 1, reporter: 'list' })

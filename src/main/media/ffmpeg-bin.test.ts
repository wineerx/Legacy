import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cloudflaredPath } from './ffmpeg-bin'

afterEach(() => { delete process.env.LEGACY_CLOUDFLARED_DIR })
describe('cloudflaredPath', () => {
  it('usa LEGACY_CLOUDFLARED_DIR quando o binário existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legacy-cf-'))
    writeFileSync(join(dir, 'cloudflared.exe'), '')
    process.env.LEGACY_CLOUDFLARED_DIR = dir
    expect(cloudflaredPath()).toBe(join(dir, 'cloudflared.exe'))
  })
})

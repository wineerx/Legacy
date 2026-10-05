import { describe, it, expect } from 'vitest'
import { contract } from './ipc-contract'

const WS = '3f2b8c1e-8d2a-4b7e-9c11-2a6b5e4d7f10'

describe('contract', () => {
  it('export.tiktok exige um lembrete por vídeo', () => {
    const base = { workspaceId: WS, assetIds: ['a', 'b'], captions: {}, stripMetadata: true }
    expect(contract['export.tiktok'].safeParse({ ...base, remindAt: [null, null] }).success).toBe(true)
    expect(contract['export.tiktok'].safeParse({ ...base, remindAt: [null] }).success).toBe(false)
  })
  it('png acima de 20 MB é recusado', () => {
    const mk = (n: number) => ({ workspaceId: WS, assetId: 'a', templateId: 't', png: new Uint8Array(n) })
    expect(contract['versions.saveCover'].safeParse(mk(1024)).success).toBe(true)
    expect(contract['versions.saveCover'].safeParse(mk(20 * 1024 * 1024 + 1)).success).toBe(false)
  })
})

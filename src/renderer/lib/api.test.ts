import { describe, it, expect, vi } from 'vitest'
import { call, ApiError, mediaUrl } from './api'

describe('api', () => {
  it('desembrulha ok', async () => {
    window.legacy = { invoke: vi.fn().mockResolvedValue({ ok: true, data: [1] }), on: vi.fn(), pathForFile: vi.fn(), version: 't' }
    await expect(call('jobs.list', { workspaceId: 'w' })).resolves.toEqual([1])
  })
  it('lança ApiError com código', async () => {
    window.legacy = { invoke: vi.fn().mockResolvedValue({ ok: false, error: { code: 'not_found', message: 'Não achei.' } }), on: vi.fn(), pathForFile: vi.fn(), version: 't' }
    await expect(call('jobs.list', { workspaceId: 'w' })).rejects.toMatchObject({ code: 'not_found', message: 'Não achei.' })
    await expect(call('jobs.list', { workspaceId: 'w' })).rejects.toBeInstanceOf(ApiError)
  })
  it('mediaUrl codifica o caminho', () => {
    expect(mediaUrl('C:\\a b\\c.jpg')).toBe('legacy-media://file/C%3A%5Ca%20b%5Cc.jpg')
  })
})

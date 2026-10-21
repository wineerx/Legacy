import { describe, it, expect } from 'vitest'
import type { ContainerDetail, ContainerItemView } from '@shared/publication-containers'
import type { GridItem } from '@shared/types'
import { mockBridge, WS_ID } from '../../test-utils'
import { appendVideos, draftPayload, editableDraft, existingVideo, loadFullDraft, moveVideo, selectedVideo, topLibraryVideos } from './container-draft'

import { media, item, detail } from './container-draft.fixtures'

describe('Container draft helpers', () => {
  it('anexa sem repetir os existentes e mantém a ordem', () => {
    const original = [existingVideo(item('a'))]
    const result = appendVideos(original, [media('b'), media('a'), media('b'), media('c')])
    expect(result.map(v => v.input.assetId)).toEqual(['a', 'b', 'c'])
    expect(result[0]).toBe(original[0])
  })
  it('preserva origem, receita e opções do PR 01 em atualização integral', () => {
    const d = detail(['a'])
    Object.assign(d.container, { captionBase: 'base', intervalMin: 30, plannedStartAt: '2026-10-10T13:00:00Z' })
    Object.assign(d.items[0], { captionOverride: 'override', recipeVersionId: 'recipe', shareToFeed: false, allowRepost: true })
    Object.assign(d.items[0].source, { postId: 'post' })
    const payload = draftPayload(d, 'Novo nome', { id: '123', revision: 'rev' }, d.items.map(existingVideo), 'UTC')
    expect(payload).toMatchObject({ captionBase: 'base', intervalMin: 30, timeZone: 'America/Sao_Paulo', plannedStartAt: '2026-10-10T13:00:00Z', destinationAccountId: '123', provider: 'instagram' })
    expect(payload.items[0]).toEqual({ assetId: 'a', sourcePostId: 'post', captionOverride: 'override', recipeVersionId: 'recipe', shareToFeed: false, allowRepost: true })
  })
  it('reordena sem mutação e rejeita índices inválidos', () => {
    const videos = ['a', 'b', 'c'].map(id => selectedVideo(media(id)))
    expect(moveVideo(videos, 0, 2).map(v => v.input.assetId)).toEqual(['b', 'c', 'a'])
    expect(videos.map(v => v.input.assetId)).toEqual(['a', 'b', 'c'])
    expect(moveVideo(videos, -1, 0)).toBe(videos)
  })
  it('bloqueia agendados/cancelados e ativos sem arquivo e limite de 1.000', () => {
    const d = detail(); expect(editableDraft(d)).toBe(true)
    d.container.scheduledAt = '2026-10-10T13:00:00Z'; expect(editableDraft(d)).toBe(false)
    d.container.scheduledAt = null; d.container.controlState = 'cancelled'; expect(editableDraft(d)).toBe(false)
    expect(() => existingVideo({ ...item('x'), assetId: null })).toThrow('não está mais disponível')
    expect(() => appendVideos(Array.from({ length: 1000 }, (_, n) => existingVideo(item(String(n)))), [media('extra')])).toThrow('1.000')
  })
  it('carrega todas as páginas antes de substituir itens', async () => {
    const d = detail(Array.from({ length: 205 }, (_, n) => String(n)))
    const invoke = mockBridge({ 'containers.get': ({ page }) => ({ ...d, page, items: d.items.slice((page - 1) * 100, page * 100) }) })
    expect((await loadFullDraft(WS_ID, d.container.id)).items).toHaveLength(205)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
  it('não mistura revisões ao paginar', async () => {
    const d = detail(Array.from({ length: 101 }, (_, n) => String(n)))
    mockBridge({ 'containers.get': ({ page }) => ({ ...d, container: { ...d.container, revision: page }, items: d.items.slice((page - 1) * 100, page * 100) }) })
    await expect(loadFullDraft(WS_ID, d.container.id)).rejects.toThrow('mudou durante a leitura')
  })
  it('Top N atravessa páginas conservando filtros e ordenação', async () => {
    const all = Array.from({ length: 250 }, (_, n) => media(String(n)))
    const invoke = mockBridge({ 'grid.query': ({ limit, offset }) => ({ items: all.slice(offset, offset + limit), total: 250 }) })
    const q = { workspaceId: WS_ID, source: 'library' as const, text: 'teste', favoritesOnly: true, sortBy: 'views' as const, sortDir: 'desc' as const }
    const result = await topLibraryVideos(q, 205)
    expect(result).toHaveLength(205)
    expect(invoke).toHaveBeenNthCalledWith(1, 'grid.query', { ...q, limit: 200, offset: 0 })
    expect(invoke).toHaveBeenNthCalledWith(2, 'grid.query', { ...q, limit: 5, offset: 200 })
    await expect(topLibraryVideos(q, 0)).rejects.toThrow('Top N')
  })
})

import { containerDraftInput, type ContainerDetail, type ContainerDraftInput, type ContainerItemView } from '@shared/publication-containers'
import type { GridItem, GridQuery } from '@shared/types'
import type { ContainerVisualSnapshot } from '@shared/container-visual'
import { call } from '../../lib/api'

export interface DraftVideo {
  key: string
  name: string
  input: NonNullable<ContainerDraftInput['items']>[number]
  media?: GridItem
}

export const editableDraft = (detail: ContainerDetail) => detail.container.state === 'draft' && detail.container.controlState === 'active' && !detail.container.scheduledAt

// updateDraft replaces the whole ordered list. Never save a partial or mixed revision.
export async function loadFullDraft(workspaceId: string, containerId: string): Promise<ContainerDetail> {
  const first = await call('containers.get', { workspaceId, containerId, page: 1, pageSize: 100 })
  const items = [...first.items]
  for (let page = 2; items.length < first.total; page++) {
    const next = await call('containers.get', { workspaceId, containerId, page, pageSize: 100 })
    if (next.container.revision !== first.container.revision || next.total !== first.total || !next.items.length) throw new Error('O Container mudou durante a leitura. Abra novamente para revisar.')
    items.push(...next.items)
  }
  return { ...first, items }
}

export function existingVideo(item: ContainerItemView): DraftVideo {
  if (!item.assetId) throw new Error('Um vídeo deste rascunho não está mais disponível. Atualize antes de editar.')
  // The PR 01 source snapshot already includes postId; retain it when replacing items.
  const source = item.source as ContainerItemView['source'] & { postId?: string }
  return { key: item.id, name: source.name, input: {
    assetId: item.assetId, captionOverride: item.captionOverride,
    ...(source.postId ? { sourcePostId: source.postId } : {}),
    ...(item.recipeVersionId ? { recipeVersionId: item.recipeVersionId } : {}),
    shareToFeed: item.shareToFeed, allowRepost: item.allowRepost
  } }
}

export function selectedVideo(media: GridItem): DraftVideo {
  const assetId = media.kind === 'asset' ? media.id : media.assetId
  if (!assetId) throw new Error('Escolha vídeos disponíveis na Biblioteca.')
  return { key: crypto.randomUUID(), name: media.caption || 'Vídeo sem nome', media,
    input: { assetId, ...(media.postId ? { sourcePostId: media.postId } : {}) } }
}

export function appendVideos(current: DraftVideo[], selected: GridItem[]): DraftVideo[] {
  const seen = new Set(current.map(v => v.input.assetId))
  const additions = selected.map(selectedVideo).filter(v => {
    if (seen.has(v.input.assetId)) return false
    seen.add(v.input.assetId); return true
  })
  if (current.length + additions.length > 1000) throw new Error('Um Container aceita até 1.000 vídeos.')
  return [...current, ...additions]
}

export function moveVideo(videos: DraftVideo[], from: number, to: number): DraftVideo[] {
  if (from < 0 || to < 0 || from >= videos.length || to >= videos.length || from === to) return videos
  const result = [...videos], [item] = result.splice(from, 1)
  result.splice(to, 0, item); return result
}

export function draftPayload(detail: ContainerDetail | null, name: string, destination: { id: string; revision: string | null } | null, videos: DraftVideo[], timeZone: string, changes?: { visualSnapshot: ContainerVisualSnapshot; plannedStartAt: string | null; intervalMin: number; trialGraduation?: 'MANUAL' | 'SS_PERFORMANCE' | null }) {
  const c = detail?.container
  return containerDraftInput.parse({ name, destinationAccountId: destination?.id ?? null,
    provider: destination ? 'instagram' : null, accountRevision: destination?.revision ?? null,
    timeZone: c?.timeZone ?? timeZone, plannedStartAt: changes ? changes.plannedStartAt : c?.plannedStartAt ?? null,
    intervalMin: changes?.intervalMin ?? c?.intervalMin ?? 15,
    trialGraduation: changes?.trialGraduation !== undefined ? changes.trialGraduation : c?.trialGraduation ?? null, captionBase: c?.captionBase ?? '',
    visualSnapshot: changes?.visualSnapshot ?? c?.visualSnapshot ?? { version: 1 }, items: videos.map(v => v.input) })
}

export async function topLibraryVideos(q: Omit<GridQuery, 'limit' | 'offset'>, count: number): Promise<GridItem[]> {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Informe um Top N entre 1 e 1.000.')
  const items: GridItem[] = []
  while (items.length < count) {
    const limit = Math.min(200, count - items.length)
    const page = await call('grid.query', { ...q, limit, offset: items.length })
    items.push(...page.items)
    if (page.items.length < limit || items.length >= page.total) break
  }
  return items
}

export async function libraryVideo(workspaceId: string, assetId: string): Promise<GridItem> {
  const page = await call('grid.query', { workspaceId, source: 'library', assetId, sortBy: 'importedAt', sortDir: 'desc', limit: 1, offset: 0 })
  if (!page.items[0]) throw new Error('Um vídeo selecionado não está mais na Biblioteca. Revise a seleção.')
  return page.items[0]
}

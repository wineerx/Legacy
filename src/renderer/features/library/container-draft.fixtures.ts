import type { ContainerDetail, ContainerItemView } from '@shared/publication-containers'
import type { GridItem } from '@shared/types'
import { WS_ID } from '../../test-utils'

export const media = (id: string): GridItem => ({ id, kind: 'asset', caption: `${id}.mp4`, filePath: `C:/${id}.mp4`, thumbnailPath: null, permalink: null, postedAt: null, durationMs: 1000, metrics: { views: null, likes: null, comments: null }, badges: [] })
export const item = (id: string): ContainerItemView => ({ id, position: 0, assetId: id, source: { name: `${id}.mp4`, sha256: 'sha', origin: 'pc' }, captionOverride: null, plannedPublishAt: null, recipeVersionId: null, jobId: null, jobState: null, confirmed: false, effectiveCaption: null, shareToFeed: true, allowRepost: false })
export const detail = (ids = ['a', 'b']): ContainerDetail => ({
  container: { id: '705e4d11-07c3-424a-8dce-7b3107f030f9', workspaceId: WS_ID, name: 'Meu lote', revision: 1, provider: null, destinationAccountId: null, accountRevision: null, timeZone: 'America/Sao_Paulo', plannedStartAt: null, plannedEndAt: null, intervalMin: 15, trialGraduation: null, captionBase: '', visualSnapshot: { version: 1 }, scheduledAt: null, controlState: 'active', state: 'draft', counts: { total: ids.length, confirmed: 0, pending: ids.length, running: 0, failed: 0, cancelled: 0, terminal: 0, started: 0, remoteOpen: 0, waitingQuota: 0 }, plannedDurationMin: null, estimatedEndAt: null, delayMin: null, quotaDemand: ids.length, quotaTotal: null, quotaAvailable: null, firstStartedAt: null, lastConfirmedAt: null, createdAt: '2026-10-09T13:00:00Z', updatedAt: '2026-10-09T13:00:00Z' },
  items: ids.map(item), page: 1, pageSize: 100, total: ids.length
})


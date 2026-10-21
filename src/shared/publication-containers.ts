import { z } from 'zod'
import type { JobState } from './types'
import { containerVisualSnapshot, type ContainerVisualSnapshot } from './container-visual'

export const containerState = z.enum(['draft', 'scheduled', 'in_progress', 'paused', 'completed', 'completed_with_failures', 'cancelled'])
export type PublicationContainerState = z.infer<typeof containerState>
export const containerItemInput = z.object({
  assetId: z.string().min(1).max(64), captionOverride: z.string().max(2200).nullable().default(null),
  sourcePostId: z.string().min(1).max(64).optional(),
  recipeVersionId: z.string().min(1).max(64).optional(),
  shareToFeed: z.boolean().default(true), allowRepost: z.boolean().default(false)
}).strict()
export const containerDraftInput = z.object({
  name: z.string().trim().min(1).max(120),
  destinationAccountId: z.string().regex(/^\d+$/).nullable().default(null),
  provider: z.literal('instagram').nullable().default(null),
  accountRevision: z.string().min(1).nullable().default(null),
  timeZone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true } catch { return false } }, 'Fuso inválido.').optional(),
  plannedStartAt: z.iso.datetime({ offset: true }).nullable().default(null),
  intervalMin: z.number().int().min(15).max(10080).default(15),
  trialGraduation: z.enum(['MANUAL', 'SS_PERFORMANCE']).nullable().default(null),
  captionBase: z.string().max(2200).default(''),
  visualSnapshot: containerVisualSnapshot.default({ version: 1 }),
  items: z.array(containerItemInput).max(1000).default([])
}).strict().refine(v => Boolean(v.provider) === Boolean(v.destinationAccountId), 'Informe plataforma e conta juntas.')
export type ContainerDraftInput = z.input<typeof containerDraftInput>

export interface ContainerCounts {
  total: number; confirmed: number; pending: number; running: number; failed: number; cancelled: number;
  terminal: number; started: number; remoteOpen: number; waitingQuota: number
}
export interface PublicationContainer {
  id: string; workspaceId: string; name: string; revision: number;
  provider: 'instagram' | null; destinationAccountId: string | null; accountRevision: string | null;
  timeZone: string; plannedStartAt: string | null; plannedEndAt: string | null; intervalMin: number; trialGraduation: 'MANUAL' | 'SS_PERFORMANCE' | null;
  captionBase: string; visualSnapshot: ContainerVisualSnapshot; scheduledAt: string | null;
  controlState: 'active' | 'paused' | 'cancelled'; state: PublicationContainerState;
  counts: ContainerCounts; plannedDurationMin: number | null; estimatedEndAt: string | null; delayMin: number | null;
  quotaDemand: number; quotaTotal: number | null; quotaAvailable: number | null;
  firstStartedAt: string | null; lastConfirmedAt: string | null; createdAt: string; updatedAt: string
}
export interface ContainerItemView {
  id: string; position: number; assetId: string | null; source: { name: string; sha256: string; origin: string };
  captionOverride: string | null; plannedPublishAt: string | null; recipeVersionId: string | null;
  jobId: string | null; jobState: JobState | null; confirmed: boolean;
  effectiveCaption: string | null; shareToFeed: boolean; allowRepost: boolean
}
export interface ContainerDetail { container: PublicationContainer; items: ContainerItemView[]; page: number; pageSize: number; total: number }
export interface ContainerPage { items: PublicationContainer[]; total: number; page: number; pageSize: number }

export function projectContainerState(scheduled: boolean, control: PublicationContainer['controlState'], n: ContainerCounts): PublicationContainerState {
  if (control === 'cancelled') return 'cancelled'
  if (!scheduled) return 'draft'
  if (n.total > 0 && n.confirmed === n.total) return 'completed'
  if (n.total > 0 && n.terminal === n.total) return 'completed_with_failures'
  if (control === 'paused') return 'paused'
  return n.started > 0 ? 'in_progress' : 'scheduled'
}

// Only these durable checkpoints authorize remote reconciliation while controls block new POSTs.
export interface PublicationCheckpoint { creating?: boolean; containerId?: string; publishing?: boolean; mediaId?: string; stage?: string }
export function remoteStarted(c: PublicationCheckpoint): boolean { return Boolean(c.creating || c.containerId || c.publishing || c.mediaId) }
export function publishUncertain(c: PublicationCheckpoint): boolean { return Boolean(c.publishing || c.mediaId) }

import { createHash } from 'node:crypto'
import { workspaceDir, resolveInside } from '../paths'
import { and, eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { containerVisualSnapshot, hasContainerVisual, type ContainerVisualSnapshot, type VisualPreviewOverrides } from '@shared/container-visual'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { publicationContainers } from '../db/schema'
import { resolveLayout, RENDERER_VERSION, type VisualLayout } from '@shared/visual-layout'
import { insertVersion, listVersions, getAsset } from '../repos/assets'

export const visualHash = (snapshot: ContainerVisualSnapshot) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
/** Seal over everything a frozen recipe contributes to the render, in a fixed field order. */
export const recipeSeal = (p: Record<string, any>) => createHash('sha256').update(JSON.stringify({ containerVisual: p.containerVisual ?? null, visualOverride: p.visualOverride ?? null,
  layoutContext: p.layoutContext ?? null, rendererVersion: p.rendererVersion ?? null, sourceSha256: p.sourceSha256 ?? null })).digest('hex')
export interface ResolvedVisual {
  layout?:VisualLayout
  coverFrameMs?:number
  watermark?: NonNullable<ContainerVisualSnapshot['watermark']>
  banner?: { imageData?: string; path?: string; startMs: number; endMs: number; firstFrame: boolean }
  cover?: { imageData?: string; path?: string }
  sourcePath?: string
}
export function resolveVisual(snapshot: ContainerVisualSnapshot, override: ResolvedVisual = {}): ResolvedVisual {
  const value: ResolvedVisual = {
    ...(snapshot.version===2?{layout:snapshot.layout,coverFrameMs:snapshot.coverFrameMs}:{}),
    watermark: snapshot.watermark?.enabled && snapshot.watermark.opacityPct > 0 ? snapshot.watermark : undefined,
    banner: snapshot.banner?.enabled ? { imageData: snapshot.banner.imageData!, startMs: snapshot.banner.startMs, endMs: snapshot.banner.endMs, firstFrame: false } : undefined,
    cover: snapshot.cover?.enabled ? { imageData: snapshot.cover.imageData! } : undefined
  }
  if (override.sourcePath) { delete value.banner; delete value.cover;delete value.coverFrameMs }
  if(override.cover)delete value.coverFrameMs
  return { ...value, ...override }
}
export function frozenRecipeVisual(ctx: Ctx, ws: string, params: Record<string, any>): ResolvedVisual {
  const ref = params.containerVisual
  // Recipes planned before the seal existed keep working; sealed ones must match exactly.
  if (params.recipeSha256 !== undefined && recipeSeal(params) !== params.recipeSha256) throw new AppError('invalid_input', 'A receita congelada foi alterada depois do agendamento.')
  if (params.rendererVersion !== undefined && params.rendererVersion !== RENDERER_VERSION) throw new AppError('invalid_input', 'O renderizador de Templates mudou desde o agendamento. Reagende este vídeo para revisar o resultado.')
  const row = ctx.db.select({ snapshot: publicationContainers.visualSnapshotJson, scheduledAt: publicationContainers.scheduledAt }).from(publicationContainers)
    .where(and(eq(publicationContainers.workspaceId, ws), eq(publicationContainers.id, ref.containerId))).get()
  if (!row?.scheduledAt) throw new AppError('invalid_input', 'Snapshot visual agendado não encontrado.')
  const snapshot = containerVisualSnapshot.parse(JSON.parse(row.snapshot))
  if (visualHash(snapshot) !== ref.sha256) throw new AppError('invalid_input', 'O snapshot visual congelado foi alterado.')
  const result=resolveVisual(snapshot, params.visualOverride ?? {})
  if(snapshot.version===2)result.layout=resolveLayout(snapshot.layout,params.layoutContext ?? snapshot.context,true)
  return result
}
export function recipeVisualOverride(ctx: Ctx, ws: string, assetId: string, versionId?: string): ResolvedVisual {
  if (!versionId) return {}
  const version = listVersions(ctx.db, ws, assetId).find(v => v.id === versionId && v.kind === 'banner')
  if (!version) throw new AppError('invalid_input', 'Versão editada inválida neste workspace.')
  const params = JSON.parse(version.paramsJson)
  if (!params.pending) return { sourcePath: version.filePath }
  if (params.containerVisual) return frozenRecipeVisual(ctx, ws, params)
  return {
    ...(params.bannerPath ? { banner: { path: params.bannerPath, startMs: params.startMs, endMs: params.endMs, firstFrame: true } } : {}),
    ...(params.coverPath ? { cover: { path: params.coverPath } } : {})
  }
}
/** Called inside schedule's IMMEDIATE transaction: persist an immutable intention only. */
export function planContainerVisual(ctx: Ctx, ws: string, containerId: string, assetId: string, snapshot: ContainerVisualSnapshot, baseVersionId?: string, caption?:string): string | undefined {
  if (!hasContainerVisual(snapshot)) return baseVersionId
  const override = recipeVisualOverride(ctx, ws, assetId, baseVersionId)
  const layoutContext=snapshot.version===2?{...snapshot.context,caption:caption ?? snapshot.context.caption}:undefined
  if(snapshot.version===2)resolveLayout(snapshot.layout,layoutContext!,true)
  const asset = getAsset(ctx.db, ws, assetId)
  if (!asset) throw new AppError('not_found', 'Vídeo não encontrado neste workspace.')
  if(snapshot.version===2){
    if(snapshot.layout.elements.some(e=>e.visible && e.type!=='media' && e.type!=='text' && !e.imageData))throw new AppError('invalid_input','Escolha a imagem de cada logo, watermark ou banner visível antes de agendar.')
    if(snapshot.coverFrameMs!==undefined && snapshot.coverFrameMs>=asset.durationMs)throw new AppError('invalid_input','O quadro da capa excede a duração do vídeo.')
  }
  const id = newId()
  const params: Record<string, unknown> = { pending: true, containerVisual: { containerId, sha256: visualHash(snapshot) }, visualOverride: override, layoutContext, processingVersion: 2,
    // A baked individual version is the source; otherwise the JIT must find the original's imported bytes.
    ...(snapshot.version === 2 ? { rendererVersion: RENDERER_VERSION } : {}), ...(override.sourcePath ? {} : { sourceSha256: asset.sha256 }) }
  params.recipeSha256 = recipeSeal(params)
  insertVersion(ctx.db, { id, workspaceId: ws, assetId, kind: 'banner', filePath: resolveInside(workspaceDir(ctx.dataRoot, ws), 'planned', `${id}.mp4`),
    paramsJson: JSON.stringify(params), createdAt: ctx.clock().toISOString() })
  return id
}
export function visualPreviewOverrides(ctx: Ctx, ws: string, assetId: string, versionId?: string): VisualPreviewOverrides {
  if (!getAsset(ctx.db, ws, assetId)) throw new AppError('not_found', 'Vídeo não encontrado neste workspace.')
  const visual = recipeVisualOverride(ctx, ws, assetId, versionId)
  return { ...(visual.sourcePath ? { sourcePath: visual.sourcePath } : {}),
    ...(visual.banner ? { banner: { path: visual.banner.path ?? visual.banner.imageData!, startMs: visual.banner.startMs, endMs: visual.banner.endMs, firstFrame: visual.banner.firstFrame } } : {}),
    ...(visual.cover ? { coverPath: visual.cover.path ?? visual.cover.imageData! } : {}),
    ...(visual.watermark ? { watermark: visual.watermark } : {}) }
}

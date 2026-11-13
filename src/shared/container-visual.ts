import { z } from 'zod'

export { MAX_VISUAL_IMAGE_BYTES, pngDimensions, visualImage } from './visual-image'
import { pngDimensions, visualImage } from './visual-image'
import { visualLayout, visualContext, RENDERER_VERSION } from './visual-layout'
export const watermarkPosition = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
const watermark = z.object({ enabled: z.boolean(), imageData: visualImage.nullable(), position: watermarkPosition, scalePct: z.number().min(1).max(50), opacityPct: z.number().min(0).max(100) }).strict().refine(v => !v.enabled || Boolean(v.imageData), 'Escolha a imagem da marca d’água.')
const banner = z.object({ enabled: z.boolean(), imageData: visualImage.nullable(), startMs: z.number().int().min(0).max(86_400_000), endMs: z.number().int().min(1).max(86_400_000) }).strict().refine(v => !v.enabled || Boolean(v.imageData) && v.endMs > v.startMs, 'Escolha o banner e um intervalo válido.')
const cover = z.object({ enabled: z.boolean(), imageData: visualImage.nullable() }).strict().refine(v => !v.enabled || Boolean(v.imageData), 'Escolha a imagem da capa.')
export const audioTrackExtension = z.enum(['mp3', 'm4a', 'aac', 'wav'])
export const audioMode = z.enum(['replace', 'mix'])
/** The track is referenced by the SHA-256 of the imported copy; the recipe seal covers it like the image layers. */
const audio = z.object({ enabled: z.boolean(), sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(), ext: audioTrackExtension.nullable(), name: z.string().max(200),
  mode: audioMode, volumePct: z.number().min(0).max(200), originalVolumePct: z.number().min(0).max(200), startMs: z.number().int().min(0).max(86_400_000) })
  .strict().refine(v => !v.enabled || Boolean(v.sha256 && v.ext), 'Escolha a faixa de áudio.')
// Optional fields keep the existing { version: 1 } snapshots byte-for-byte compatible.
const layers = { watermark: watermark.optional(), banner: banner.optional(), cover: cover.optional(), audio: audio.optional() }
export const containerVisualSnapshot = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), ...layers }).strict(),
  z.object({ version: z.literal(2), ...layers, rendererVersion:z.literal(RENDERER_VERSION).optional(), coverFrameMs:z.number().int().min(0).max(86400000).optional(), layout: visualLayout, context: visualContext.default({}), source: z.object({ templateId: z.uuid(), templateVersion: z.number().int().positive(), templateName: z.string().max(120) }).optional() }).strict()
])
export type ContainerVisualSnapshot = z.infer<typeof containerVisualSnapshot>
export const defaultWatermark = () => ({ enabled: false, imageData: null as string | null, position: 'bottom-right' as const, scalePct: 20, opacityPct: 70 })
export const defaultBanner = () => ({ enabled: false, imageData: null as string | null, startMs: 0, endMs: 3000 })
export const defaultCover = () => ({ enabled: false, imageData: null as string | null })
export const defaultAudio = () => ({ enabled: false, sha256: null as string | null, ext: null as z.infer<typeof audioTrackExtension> | null, name: '', mode: 'replace' as const, volumePct: 100, originalVolumePct: 100, startMs: 0 })
export const hasContainerVisual = (v: ContainerVisualSnapshot) => Boolean(v.version === 2 || v.watermark?.enabled && v.watermark.opacityPct > 0 || v.banner?.enabled || v.cover?.enabled || v.audio?.enabled)

/** Shared pixel geometry: renderer overlays and FFmpeg use the same rounding/margins. */
export function watermarkGeometry(width: number, height: number, image: { width: number; height: number }, spec: { scalePct: number; position: z.infer<typeof watermarkPosition> }) {
  const w = Math.max(1, Math.round(Math.min(width * spec.scalePct / 100, height * 0.45 * image.width / image.height)))
  const h = Math.max(1, Math.round(w * image.height / image.width)), margin = Math.round(Math.min(width, height) * 0.02)
  const x = spec.position === 'center' ? Math.round((width - w) / 2) : spec.position.endsWith('right') ? width - w - margin : margin
  const y = spec.position === 'center' ? Math.round((height - h) / 2) : spec.position.startsWith('bottom') ? height - h - margin : margin
  return { width: w, height: h, x, y }
}
export interface VisualPreviewOverrides {
  watermark?: NonNullable<ContainerVisualSnapshot['watermark']>
  banner?: { path: string; startMs: number; endMs: number; firstFrame: boolean }
  coverPath?: string
  sourcePath?: string
}

import { z } from 'zod'
import { visualImage } from './visual-image'

export const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
export const visualContext = z.object({ profile_name: z.string().max(4000).optional(), username: z.string().max(4000).optional(), caption: z.string().max(4000).optional(), custom_text: z.string().max(4000).optional() }).strict()
const base = { id: z.string().min(1).max(64), x: z.number().min(-2160).max(4320), y: z.number().min(-2160).max(4320), width: z.number().min(1).max(4320), height: z.number().min(1).max(4320), opacity: z.number().min(0).max(100), radius: z.number().min(0).max(2160), borderWidth: z.number().min(0).max(100), borderColor: color, visible: z.boolean() }
const textProps = { text: z.string().max(4000).refine(s => [...s.matchAll(/\{\{(.*?)\}\}/g)].every(m => ['profile_name', 'username', 'caption', 'custom_text'].includes(m[1].trim())), 'Variável desconhecida.'), font: z.enum(['Inter', 'Roboto', 'Noto Serif']), weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]), fontSize: z.number().min(8).max(300), lineHeight: z.number().min(0.8).max(3), color, align: z.enum(['left','center','right']), padding: z.number().min(0).max(200) }
export const visualElement = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('media'), fit: z.enum(['contain','cover']), alignX: z.number().min(0).max(100), alignY: z.number().min(0).max(100), imageData: visualImage.optional() }).strict(),
  z.object({ ...base, type: z.literal('image'), imageData: visualImage.nullable() }).strict(),
  z.object({ ...base, type: z.literal('watermark'), imageData: visualImage.nullable() }).strict(),
  z.object({ ...base, type: z.literal('text'), ...textProps }).strict(),
  z.object({ ...base, type: z.literal('banner'), imageData: visualImage.nullable(), startMs: z.number().int().min(0), endMs: z.number().int().positive() }).strict().refine(v => v.endMs > v.startMs, 'Intervalo do banner inválido.')
])
export const visualLayout = z.object({ width: z.number().int().min(320).max(2160).refine(v => v % 2 === 0), height: z.number().int().min(320).max(2160).refine(v => v % 2 === 0), background: color, margin: z.number().min(0).max(500), elements: z.array(visualElement).max(32) }).strict().refine(v => v.width*v.height <= 8_000_000 && new Set(v.elements.map(e => e.id)).size === v.elements.length && v.elements.filter(e => e.type === 'media').length <= 1, 'Canvas ou elementos inválidos.')
export type VisualLayout = z.infer<typeof visualLayout>
export type VisualElement = z.infer<typeof visualElement>
export type VisualContext = z.infer<typeof visualContext>
export const RENDERER_VERSION = 'scene-1-fonts-1'
export const rect = (id: string) => ({ id, x: 32, y: 32, width: 320, height: 160, opacity: 100, radius: 0, borderWidth: 0, borderColor: '#000000', visible: true })
export function newElement<T extends VisualElement['type']>(type:T,id:string):Extract<VisualElement,{type:T}>
export function newElement(type: VisualElement['type'], id: string): VisualElement {
  const r = rect(id)
  if (type === 'media') return { ...r, type, x: 32, y: 460, width: 1016, height: 1100, fit: 'contain', alignX: 50, alignY: 50 }
  if (type === 'text') return { ...r, type, text: 'Novo texto', font: 'Inter', weight: 700, fontSize: 48, lineHeight: 1.2, color: '#000000', align: 'left', padding: 8 }
  if (type === 'banner') return { ...r, type, imageData: null, startMs: 0, endMs: 3000 }
  return { ...r, type, imageData: null }
}
export const blankLayout = (): VisualLayout => ({ width:1080, height:1920, background:'#ffffff', margin:32, elements:[newElement('media','media')] })
export function expandText(text: string, context: VisualContext, strict = false): string {
  const result = text.replace(/\{\{(.*?)\}\}/g, (_, key: string) => {
    const name = key.trim() as keyof VisualContext
    if (!['profile_name','username','caption','custom_text'].includes(name)) throw new Error('Variável desconhecida.')
    if (strict && !context[name]) throw new Error(`Preencha a variável ${name} antes de agendar.`)
    return context[name] ?? ''
  })
  if (result.length > 4000) throw new Error('O texto expandido excede 4.000 caracteres.')
  return result
}
export function resolveLayout(layout: VisualLayout, context: VisualContext, strict = false): VisualLayout {
  return { ...layout, elements: layout.elements.map(e => e.type === 'text' ? { ...e, text: expandText(e.text,context,strict) } : { ...e }) }
}
export function fitRect(srcWidth: number, srcHeight: number, element: Extract<VisualElement,{type:'media'}>) {
  const scale = element.fit === 'cover' ? Math.max(element.width/srcWidth,element.height/srcHeight) : Math.min(element.width/srcWidth,element.height/srcHeight)
  const width = srcWidth*scale, height=srcHeight*scale
  return { x:element.x+(element.width-width)*element.alignX/100, y:element.y+(element.height-height)*element.alignY/100, width,height }
}

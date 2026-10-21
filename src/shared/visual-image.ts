import { z } from 'zod'
export const MAX_VISUAL_IMAGE_BYTES = 1024 * 1024
export function pngDimensions(data: string): { width: number; height: number } {
  const encoded = data.startsWith('data:image/png;base64,') ? data.slice(22) : ''
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  if (bytes.length < 33 || bytes.length > MAX_VISUAL_IMAGE_BYTES || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR') throw new Error('Use uma imagem PNG de até 1 MB.')
  const view = new DataView(bytes.buffer), width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) throw new Error('A imagem deve ter até 4.096 pixels por lado e 16 megapixels.')
  return { width, height }
}
export const visualImage = z.string().max(1_398_126).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).refine(data => { try { pngDimensions(data); return true } catch { return false } }, 'Use uma imagem PNG válida de até 1 MB e 4.096 pixels por lado.')

import type { CoverTextSpec } from '@shared/types'

export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next) > maxWidth) { out.push(line); line = word }
      else line = next
    }
    out.push(line)
  }
  return out
}

export function coverTextLayout(spec: CoverTextSpec, w: number, h: number, lines: number) {
  const fontPx = Math.round((w * spec.fontSizePct) / 100)
  const lineHeight = Math.round(fontPx * 1.2)
  const pad = Math.round(fontPx * 0.4)
  const boxH = lines * lineHeight + pad * 2
  const boxY = spec.position === 'top' ? Math.round(h * 0.12)
    : spec.position === 'center' ? Math.round(h / 2 - boxH / 2)
    : Math.round(h * 0.78) - boxH
  return { fontPx, lineHeight, boxY, boxH, pad }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'))
    img.src = src
  })
}

function drawText(ctx: CanvasRenderingContext2D, spec: CoverTextSpec, w: number, h: number): void {
  ctx.font = `700 ${Math.round((w * spec.fontSizePct) / 100)}px "Inter Variable", "Segoe UI", sans-serif`
  const maxWidth = w * 0.86
  const lines = wrapText(spec.text, maxWidth, (s) => ctx.measureText(s).width)
  const l = coverTextLayout(spec, w, h, lines.length)
  const textW = Math.max(...lines.map((s) => ctx.measureText(s).width))
  if (spec.background) {
    ctx.fillStyle = spec.background
    const bw = textW + l.pad * 2
    ctx.beginPath()
    ctx.roundRect((w - bw) / 2, l.boxY, bw, l.boxH, l.pad)
    ctx.fill()
  }
  ctx.fillStyle = spec.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  lines.forEach((s, i) => ctx.fillText(s, w / 2, l.boxY + l.pad + i * l.lineHeight + (l.lineHeight - l.fontPx) / 2))
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) throw new Error('Falha ao gerar PNG.')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function renderCoverPng(bg: CanvasImageSource | null, spec: CoverTextSpec | null, w = 1080, h = 1920): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  if (bg) {
    const iw = (bg as HTMLImageElement).naturalWidth || (bg as HTMLCanvasElement).width
    const ih = (bg as HTMLImageElement).naturalHeight || (bg as HTMLCanvasElement).height
    const scale = Math.max(w / iw, h / ih)
    ctx.drawImage(bg, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale)
  }
  if (spec?.text.trim()) drawText(ctx, spec, w, h)
  return toPng(canvas)
}

export async function renderBannerPng(spec: CoverTextSpec, w: number, h: number): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  drawText(canvas.getContext('2d')!, spec, w, h)
  return toPng(canvas)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { blankLayout, newElement, type VisualLayout } from '@shared/visual-layout'
import { renderComposition, detectH264Encoder } from './ops'
import { probe } from './probe'
import { ffmpegPaths } from './ffmpeg-bin'
import { runTool } from './run'

const dir = mkdtempSync(join(tmpdir(), 'legacy-composition-'))
const ff = (args: string[]) => runTool(ffmpegPaths().ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args])
/** Landscape 640×360: left half red, right half blue, with audio. */
const source = join(dir, 'source.mp4')
const png = (name: string, filter: string) => { const out = join(dir, name); return ff(['-f', 'lavfi', '-i', filter, '-frames:v', '1', out]).then(() => out) }
async function pixel(file: string, ms: number, x: number, y: number): Promise<[number, number, number]> {
  const out = join(dir, `px-${ms}-${x}-${y}-${Math.random().toString(36).slice(2)}.rgb`)
  await ff(['-ss', (ms / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', out])
  const [r, g, b] = readFileSync(out); return [r, g, b]
}
const near = (actual: [number, number, number], expected: [number, number, number], tolerance = 40) =>
  expect(actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance), `${actual} ≈ ${expected}`).toBe(true)
const RED: [number, number, number] = [255, 0, 0], BLUE: [number, number, number] = [0, 0, 255], WHITE: [number, number, number] = [255, 255, 255]
let encoder: string | null = null
const layoutWith = (media: Partial<Extract<VisualLayout['elements'][number], { type: 'media' }>>, extra: VisualLayout['elements'] = []): VisualLayout =>
  ({ ...blankLayout(), width: 400, height: 400, background: '#ffffff', elements: [{ ...newElement('media', 'media'), ...media }, ...extra] })

beforeAll(async () => {
  encoder = await detectH264Encoder().catch(() => null)
  await ff(['-f', 'lavfi', '-i', 'color=red:s=320x360:r=30:d=2', '-f', 'lavfi', '-i', 'color=blue:s=320x360:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-filter_complex', '[0:v][1:v]hstack', '-c:v', 'mpeg4', '-q:v', '2', '-c:a', 'aac', '-shortest', source])
}, 60_000)

describe('renderComposition (FFmpeg real, mesma geometria do preview)', () => {
  it('contain com dimensões ímpares e alinhamento extremo não estoura o pad; preserva áudio e duração', async (ctx) => {
    if (!encoder) ctx.skip()
    const background = await png('bg-white.png', 'color=white:s=400x400')
    for (const [i, media] of ([{ x: 11, y: 13, width: 301, height: 203, fit: 'contain', alignX: 100, alignY: 100 }, { x: 0, y: 0, width: 333, height: 177, fit: 'contain', alignX: 0, alignY: 37 },
      // Regression: rounding put oy+rh at 98 > 97 and FFmpeg rejected the pad.
      { x: 20, y: 20, width: 136, height: 97, fit: 'contain', alignX: 100, alignY: 100 }] as const).entries()) {
      const out = join(dir, `contain-${i}.mp4`)
      await renderComposition(source, out, layoutWith(media), { background, layers: [] })
      const p = await probe(out)
      expect(p).toMatchObject({ width: 400, height: 400, audioCodec: 'aac' })
      expect(Math.abs(p.durationMs - 2000)).toBeLessThan(150)
    }
    // Box 11..312 × 13..216, 16:9 content height 169 aligned to the bottom: top band stays background.
    const out = join(dir, 'contain-0.mp4')
    near(await pixel(out, 500, 60, 20), WHITE)
    near(await pixel(out, 500, 60, 200), RED)
    near(await pixel(out, 500, 280, 200), BLUE)
    near(await pixel(out, 500, 380, 380), WHITE)
    // FFmpeg silently re-centres an overflowing pad (rows 30..106 instead of 40..116); preview anchors to the bottom.
    const anchored = join(dir, 'contain-2.mp4')
    near(await pixel(anchored, 500, 60, 113), RED)
    near(await pixel(anchored, 500, 60, 34), WHITE)
  })

  it('cover recorta conforme alignX: 0 mostra a metade vermelha, 100 a azul', async (ctx) => {
    if (!encoder) ctx.skip()
    const background = await png('bg-white-2.png', 'color=white:s=400x400')
    const left = join(dir, 'cover-left.mp4'), right = join(dir, 'cover-right.mp4')
    await renderComposition(source, left, layoutWith({ x: 100, y: 0, width: 201, height: 400, fit: 'cover', alignX: 0, alignY: 50 }), { background, layers: [] })
    await renderComposition(source, right, layoutWith({ x: 100, y: 0, width: 201, height: 400, fit: 'cover', alignX: 100, alignY: 50 }), { background, layers: [] })
    near(await pixel(left, 500, 200, 200), RED)
    near(await pixel(right, 500, 200, 200), BLUE)
    near(await pixel(left, 500, 50, 200), WHITE)
  })

  it('máscara de radius, camada PNG com alpha e janela temporal do banner', async (ctx) => {
    if (!encoder) ctx.skip()
    const background = await png('bg-white-3.png', 'color=white:s=400x400')
    // Mask: white only inside the box minus a 40 px corner, emulating rounded corners.
    const mask = await png('mask.png', "color=white:s=200x200,format=gray,geq=lum='if(lt(X,40)*lt(Y,40),0,255)'")
    const logo = await png('logo.png', "color=black@0:s=400x400,format=rgba,geq=r=0:g=255:b=0:a='if(between(X,300,350)*between(Y,20,70),128,0)'")
    const banner = await png('banner.png', "color=black@0:s=400x400,format=rgba,geq=r=255:g=255:b=0:a='if(gt(Y,350),255,0)'")
    const layout = layoutWith({ x: 50, y: 100, width: 200, height: 200, fit: 'cover', alignX: 0, alignY: 50, radius: 40 }, [
      { ...newElement('image', 'logo'), x: 300, y: 20, width: 50, height: 50 },
      { ...newElement('banner', 'banner'), x: 0, y: 350, width: 400, height: 50, startMs: 0, endMs: 600 }
    ])
    const out = join(dir, 'layers.mp4')
    await renderComposition(source, out, layout, { background, mask, layers: [{ id: 'logo', path: logo }, { id: 'banner', path: banner }] })
    near(await pixel(out, 500, 55, 105), WHITE)          // masked corner falls back to the background
    near(await pixel(out, 500, 150, 200), RED)           // media inside the box
    near(await pixel(out, 500, 325, 45), [128, 255, 128]) // 50% green over white
    near(await pixel(out, 300, 200, 380), [255, 255, 0])  // banner visible inside its window
    near(await pixel(out, 1500, 200, 380), WHITE)         // and gone after it
  })
})

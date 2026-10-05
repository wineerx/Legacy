import { describe, it, expect } from 'vitest'
import { wrapText, coverTextLayout } from './canvas'

const measure = (s: string) => s.length * 10

describe('wrapText', () => {
  it('quebra por palavras respeitando largura', () => {
    expect(wrapText('um dois tres quatro', 90, measure)).toEqual(['um dois', 'tres', 'quatro'])
  })
  it('palavra maior que a largura fica sozinha', () => {
    expect(wrapText('supercalifragilistico ok', 50, measure)).toEqual(['supercalifragilistico', 'ok'])
  })
  it('respeita quebras de linha explícitas', () => {
    expect(wrapText('EP 1\nNaruto', 500, measure)).toEqual(['EP 1', 'Naruto'])
  })
})

describe('coverTextLayout', () => {
  const spec = { text: 'x', position: 'bottom' as const, fontSizePct: 8, color: '#FFFFFF', background: null }
  it('fonte proporcional à largura', () => {
    expect(coverTextLayout(spec, 1080, 1920, 1).fontPx).toBe(86)
  })
  it('base termina em 78% da altura', () => {
    const l = coverTextLayout(spec, 1080, 1920, 2)
    expect(l.boxY + l.boxH).toBe(Math.round(1920 * 0.78))
  })
  it('topo começa em 12%', () => {
    expect(coverTextLayout({ ...spec, position: 'top' }, 1080, 1920, 1).boxY).toBe(Math.round(1920 * 0.12))
  })
  it('centro centralizado', () => {
    const l = coverTextLayout({ ...spec, position: 'center' }, 1080, 1920, 1)
    expect(Math.abs(l.boxY + l.boxH / 2 - 960)).toBeLessThanOrEqual(1)
  })
})

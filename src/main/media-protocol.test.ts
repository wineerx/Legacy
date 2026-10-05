import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { parseMediaUrl } from './media-protocol'
import { PathEscapeError } from './paths'

const root = 'C:\\Users\\x\\AppData\\Roaming\\Legacy'
const url = (p: string) => `legacy-media://file/${encodeURIComponent(p)}`

describe('parseMediaUrl', () => {
  it('aceita arquivo dentro da pasta de dados', () => {
    const p = join(root, 'workspaces', 'a', 'media', 'b', 'thumb.jpg')
    expect(parseMediaUrl(url(p), root)).toBe(p)
  })
  it('bloqueia arquivo fora', () => {
    expect(() => parseMediaUrl(url('C:\\Windows\\win.ini'), root)).toThrow(PathEscapeError)
  })
  it('bloqueia o banco na raiz da pasta de dados', () => {
    expect(() => parseMediaUrl(url(join(root, 'legacy.sqlite')), root)).toThrow(PathEscapeError)
  })
  it('bloqueia travessia com ..', () => {
    expect(() => parseMediaUrl(url(join(root, 'workspaces', '..', 'legacy.sqlite')), root)).toThrow(PathEscapeError)
  })
  it('rejeita percent-encoding malformado', () => {
    expect(() => parseMediaUrl('legacy-media://file/%E0%A4%A', root)).toThrow()
  })
  it('bloqueia outro host', () => {
    expect(() => parseMediaUrl('legacy-media://evil/x', root)).toThrow()
  })
})

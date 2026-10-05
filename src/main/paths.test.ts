import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveInside, workspaceDir, PathEscapeError } from './paths'

describe('resolveInside', () => {
  const root = join('C:\\', 'data')
  it('resolve caminho dentro da raiz', () => {
    expect(resolveInside(root, 'media', 'a.mp4')).toBe(join(root, 'media', 'a.mp4'))
  })
  it('bloqueia ..', () => {
    expect(() => resolveInside(root, '..', 'x')).toThrow(PathEscapeError)
  })
  it('bloqueia caminho absoluto fora da raiz', () => {
    expect(() => resolveInside(root, 'C:\\Windows\\x')).toThrow(PathEscapeError)
  })
  it('bloqueia pasta irmã com prefixo igual', () => {
    expect(() => resolveInside(root, '..', 'data2', 'x')).toThrow(PathEscapeError)
  })
})

describe('workspaceDir', () => {
  it('rejeita id inválido', () => {
    expect(() => workspaceDir('C:\\data', '../x')).toThrow()
  })
  it('monta caminho do workspace', () => {
    expect(workspaceDir('C:\\data', 'ab12')).toBe(join('C:\\data', 'workspaces', 'ab12'))
  })
})

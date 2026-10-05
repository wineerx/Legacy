import { resolve, relative, isAbsolute, join } from 'node:path'

export class PathEscapeError extends Error {
  constructor(target: string) {
    super(`Caminho fora da pasta permitida: ${target}`)
    this.name = 'PathEscapeError'
  }
}

export function resolveInside(root: string, ...segments: string[]): string {
  const base = resolve(root)
  const target = resolve(base, ...segments)
  const rel = relative(base, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new PathEscapeError(target)
  return target
}

const ID_RE = /^[A-Za-z0-9-]{1,64}$/

export function workspaceDir(dataRoot: string, workspaceId: string): string {
  if (!ID_RE.test(workspaceId)) throw new Error(`workspaceId inválido: ${workspaceId}`)
  return resolveInside(dataRoot, join('workspaces', workspaceId))
}

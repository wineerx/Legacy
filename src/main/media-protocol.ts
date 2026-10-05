import { join } from 'node:path'
import { PathEscapeError, resolveInside } from './paths'

export function parseMediaUrl(url: string, dataRoot: string, assetRoots: string[] = []): string {
  const u = new URL(url)
  if (u.protocol !== 'legacy-media:' || u.hostname !== 'file') throw new Error('URL de mídia inválida')
  const raw = decodeURIComponent(u.pathname.replace(/^\//, ''))
  for (const root of [join(dataRoot, 'workspaces'), ...assetRoots]) {
    try { return resolveInside(root, raw) } catch { /* Try the next registered asset directory. */ }
  }
  throw new PathEscapeError(raw)
}

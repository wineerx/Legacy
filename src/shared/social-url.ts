import { AppError } from './errors'
import { normalizeInstagramUrl } from './instagram-url'
export function normalizeSocialUrl(input: string) {
  const value = input.trim()
  if (!/^(https?:\/\/)?(www\.)?tiktok\.com\//i.test(value))
    return { ...normalizeInstagramUrl(value), platform: 'instagram' as const }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    throw new AppError('invalid_url', 'Link inválido.')
  }
  const m = /^\/@([A-Za-z0-9_.]{2,64})(?:\/video\/(\d+))?\/?$/.exec(u.pathname)
  if (!m || u.username || u.password || u.port || u.protocol !== 'https:')
    throw new AppError(
      'invalid_url',
      'Use tiktok.com/@usuario ou o link completo do vídeo.'
    )
  const username = m[1].toLowerCase()
  return m[2]
    ? {
        platform: 'tiktok' as const,
        kind: 'reel' as const,
        code: m[2],
        username,
        url: `https://www.tiktok.com/@${username}/video/${m[2]}`
      }
    : {
        platform: 'tiktok' as const,
        kind: 'profile' as const,
        username,
        url: `https://www.tiktok.com/@${username}`
      }
}

import { AppError } from './errors'

export type IgRef =
  | { kind: 'profile'; username: string; url: string }
  | { kind: 'reel' | 'post'; code: string; url: string }

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const USER_RE = /^[a-z0-9._]{1,30}$/
const CODE_RE = /^[A-Za-z0-9_-]{5,64}$/
const RESERVED = new Set(['explore', 'accounts', 'direct', 'stories', 'reels', 'about', 'developer', 'legal', 'tv'])

function invalid(): never {
  throw new AppError('invalid_url', 'Link do Instagram inválido. Use instagram.com/usuario ou o link de um reel.')
}

function profile(username: string): IgRef {
  const u = username.toLowerCase()
  if (!USER_RE.test(u) || RESERVED.has(u)) invalid()
  return { kind: 'profile', username: u, url: `https://www.instagram.com/${u}/` }
}

export function normalizeInstagramUrl(input: string): IgRef {
  const raw = input.trim()
  if (raw.startsWith('@')) return profile(raw.slice(1))
  let parsed: URL
  try {
    parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    invalid()
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') invalid()
  if (!HOSTS.has(parsed.hostname.toLowerCase())) invalid()
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length === 0) invalid()
  const typeIdx = parts.findIndex((p) => p === 'reel' || p === 'p')
  if (typeIdx !== -1) {
    const code = parts[typeIdx + 1]
    if (!code || !CODE_RE.test(code)) invalid()
    const kind = parts[typeIdx] === 'reel' ? 'reel' : 'post'
    const seg = kind === 'reel' ? 'reel' : 'p'
    return { kind, code, url: `https://www.instagram.com/${seg}/${code}/` }
  }
  if (parts.length !== 1) invalid()
  let decoded: string
  try {
    decoded = decodeURIComponent(parts[0])
  } catch {
    invalid()
  }
  return profile(decoded)
}

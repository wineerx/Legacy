import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { CatalogAudioTrack } from '@shared/catalog-audio'
import type { Ctx } from '../context'
import { destinationAccounts } from '../db/schema'
import { getSecret, requireWorkspace } from './integrations'
import { facebookJson, InstagramApiError, type GraphRequest } from './instagram-publishing'

const track = z.object({
  audio_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d+$/)),
  title: z.string().nullish(), display_artist: z.string().nullish(), duration_in_ms: z.number().nullish(),
  download_url: z.string().nullish(), cover_artwork_thumbnail_uri: z.string().nullish(), on_platform_audio_preview_link: z.string().nullish()
}).loose()

/** Only Meta CDN previews play in the renderer (see its CSP); anything else is dropped instead of loaded. */
function metaUrl(value: string | null | undefined, hosts: RegExp) {
  if (!value) return null
  try { const url = new URL(value); return url.protocol === 'https:' && hosts.test(url.hostname) ? url.toString() : null } catch { return null }
}
const cdn = /(^|\.)(fbcdn\.net|cdninstagram\.com)$/
// Meta documents the list under `audio`; some answers wrap it in `data`. Accept both, ignore anything else.
function rows(raw: unknown): unknown[] {
  const value = raw as { audio?: unknown; data?: unknown }
  if (Array.isArray(value?.audio)) return value.audio
  if (Array.isArray(value?.data)) return value.data.flatMap(d => Array.isArray((d as { audio?: unknown })?.audio) ? (d as { audio: unknown[] }).audio : [d])
  return []
}

/**
 * Searches music in Meta's catalog for an Instagram account connected with Facebook Login. Returns only
 * authorized tracks; an empty list means the catalog has no match, not a failure.
 */
export async function searchInstagramAudio(query: string, igUserId: string, token: string, request: GraphRequest = facebookJson): Promise<CatalogAudioTrack[]> {
  const search = query.trim()
  if (!search || search.length > 200) throw new AppError('invalid_input', 'Digite de 1 a 200 caracteres para buscar a música.')
  if (!/^\d+$/.test(igUserId)) throw new AppError('invalid_input', 'Conta Instagram inválida.')
  const params = new URLSearchParams({ audio_type: 'music', search_query: search, user_id: igUserId })
  let raw: unknown
  try { raw = await request(`ig_audio?${params}`, token) }
  catch (error) {
    if (error instanceof InstagramApiError && !error.retryable && [10, 200, 514].includes(error.apiCode)) throw new AppError('forbidden', `A Meta recusou a busca de músicas (código ${error.apiCode}). A conta precisa estar conectada por Facebook Login, vinculada a uma Página, com instagram_basic e instagram_content_publish.`)
    throw error
  }
  return rows(raw).flatMap(item => {
    const parsed = track.safeParse(item)
    if (!parsed.success) return []
    const t = parsed.data
    return [{ id: t.audio_id, title: t.title?.trim() || 'Sem título', artist: t.display_artist?.trim() || null,
      durationMs: Number.isFinite(t.duration_in_ms) ? t.duration_in_ms! : null, previewUrl: metaUrl(t.download_url, cdn),
      coverUrl: metaUrl(t.cover_artwork_thumbnail_uri, cdn), instagramLink: metaUrl(t.on_platform_audio_preview_link, /^www\.instagram\.com$/) }]
  })
}

export async function searchAccountAudio(ctx: Ctx, ws: string, accountId: string, query: string, request: GraphRequest = facebookJson) {
  requireWorkspace(ctx, ws)
  const account = ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId, ws), eq(destinationAccounts.provider, 'instagram'), eq(destinationAccounts.providerId, accountId))).get()
  if (!account || account.state !== 'connected') throw new AppError('not_found', 'Conta não conectada neste workspace.')
  if (account.authKind !== 'facebook_login') throw new AppError('invalid_input', 'Música do catálogo exige a conta conectada por Facebook Login. Entre com Facebook em Contas.')
  const token = getSecret(ctx, ws, `instagramToken:${accountId}`)
  if (!token) throw new AppError('invalid_input', 'Entre com Facebook novamente em Contas.')
  return searchInstagramAudio(query, accountId, token, request)
}

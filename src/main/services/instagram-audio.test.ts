import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { decryptSecret } from './integrations'
import { connectFacebookAccount, connectInstagram, InstagramApiError } from './instagram-publishing'
import { searchAccountAudio, searchInstagramAudio } from './instagram-audio'

const sample = { audio: [
  { audio_id: '587784541076604', title: 'Birthday Wish', display_artist: 'Shuba', duration_in_ms: 153760, audio_type: 'music',
    download_url: 'https://video.xx.fbcdn.net/preview.mp4', cover_artwork_thumbnail_uri: 'https://scontent.cdninstagram.com/c.jpg', on_platform_audio_preview_link: 'https://www.instagram.com/reels/audio/587784541076604/' },
  { audio_id: 42, title: '', display_artist: null, duration_in_ms: null, download_url: 'https://evil.example/x.mp3' },
  { title: 'sem id' }
] }

describe('searchInstagramAudio', () => {
  it('consulta ig_audio de música com busca e usuário, e normaliza id, título, artista e prévia', async () => {
    const request = vi.fn().mockResolvedValue(sample)
    const tracks = await searchInstagramAudio('  coldplay paradise ', '17841400000000001', 'token', request)
    const [path, token, body] = request.mock.calls[0]
    expect(token).toBe('token'); expect(body).toBeUndefined()
    const params = new URLSearchParams(path.split('?')[1])
    expect(path.startsWith('ig_audio?')).toBe(true)
    expect(Object.fromEntries(params)).toEqual({ audio_type: 'music', search_query: 'coldplay paradise', user_id: '17841400000000001' })
    expect(tracks).toEqual([
      { id: '587784541076604', title: 'Birthday Wish', artist: 'Shuba', durationMs: 153760, previewUrl: 'https://video.xx.fbcdn.net/preview.mp4', coverUrl: 'https://scontent.cdninstagram.com/c.jpg', instagramLink: 'https://www.instagram.com/reels/audio/587784541076604/' },
      { id: '42', title: 'Sem título', artist: null, durationMs: null, previewUrl: null, coverUrl: null, instagramLink: null }
    ])
  })

  it('aceita a lista dentro de data e devolve vazio quando o catálogo não tem a faixa', async () => {
    expect(await searchInstagramAudio('x', '1', 't', vi.fn().mockResolvedValue({ data: [{ audio: [{ audio_id: '7', title: 'A' }] }] }))).toHaveLength(1)
    expect(await searchInstagramAudio('faixa inexistente', '1', 't', vi.fn().mockResolvedValue({ audio: [] }))).toEqual([])
    expect(await searchInstagramAudio('faixa inexistente', '1', 't', vi.fn().mockResolvedValue({}))).toEqual([])
  })

  it.each([10, 200, 514])('traduz o erro de permissão %s em orientação de Facebook Login', async code => {
    const request = vi.fn().mockRejectedValue(new InstagramApiError(400, code, undefined, undefined, 'facebook_login'))
    await expect(searchInstagramAudio('a', '1', 't', request)).rejects.toMatchObject({ code: 'forbidden', message: expect.stringContaining('Facebook Login') })
  })

  it('valida busca vazia antes de chamar a Meta', async () => {
    const request = vi.fn()
    await expect(searchInstagramAudio('   ', '1', 't', request)).rejects.toThrow(/1 a 200/)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('searchAccountAudio', () => {
  const vault = { available: () => true, encrypt: (s: string) => `protected:${s}`, decrypt: (s: string) => s.slice(10) }
  let ctx: Ctx; let ws: string
  beforeEach(() => {
    ctx = { db: memDb(), dataRoot: 'C:/test', clock: () => new Date('2026-10-05T12:00:00Z') }
    ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'America/Sao_Paulo' }).id
    ctx.secret = (w, key) => decryptSecret(ctx, vault, w, key)
  })
  it('usa o token do cofre da conta Facebook Login', async () => {
    connectFacebookAccount(ctx, vault, ws, { token: 'fb-token-value', id: '555', username: 'p', expiresAt: null, scopes: [] })
    const request = vi.fn().mockResolvedValue({ audio: [] })
    await searchAccountAudio(ctx, ws, '555', 'paradise', request)
    expect(request.mock.calls[0][1]).toBe('fb-token-value')
  })
  it('recusa conta do Instagram Login sem chamar a Meta', async () => {
    await connectInstagram(ctx, vault, ws, 'ig-token-value-123', vi.fn().mockResolvedValue({ user_id: '777', username: 'ig' }))
    const request = vi.fn()
    await expect(searchAccountAudio(ctx, ws, '777', 'paradise', request)).rejects.toThrow(/Facebook Login/)
    expect(request).not.toHaveBeenCalled()
  })
})

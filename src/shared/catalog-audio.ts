import { z } from 'zod'

/**
 * Music from Meta's catalog (Instagram Audio API). The track is referenced by `audio_id`; no audio file is
 * uploaded. Only accounts connected with Facebook Login can use it.
 * Meta documents audio_volume and video_volume as 1–100; video 0 (music only) is the product default.
 */
export const DEFAULT_AUDIO_VOLUME = 100
export const DEFAULT_VIDEO_VOLUME = 0
export const catalogAudioChoice = z.object({
  audioId: z.string().regex(/^\d{1,32}$/),
  audioVolume: z.number().int().min(1).max(100).default(DEFAULT_AUDIO_VOLUME),
  videoVolume: z.number().int().min(0).max(100).default(DEFAULT_VIDEO_VOLUME)
}).strict()
export type CatalogAudioChoice = z.output<typeof catalogAudioChoice>

export interface CatalogAudioTrack {
  id: string; title: string; artist: string | null; durationMs: number | null
  /** Temporary preview from Meta's CDN (about 1.5 days); null when Meta gives none. */
  previewUrl: string | null; coverUrl: string | null; instagramLink: string | null
}

export const sameAudio = (a?: CatalogAudioChoice | null, b?: CatalogAudioChoice | null) =>
  (a?.audioId ?? null) === (b?.audioId ?? null) && (!a?.audioId || (a.audioVolume === b?.audioVolume && a.videoVolume === b?.videoVolume))

/** One entry of mapa_audios.json: file name of the video → catalog search and volumes. */
const mapEntry = z.object({
  busca: z.string().trim().min(1).max(200),
  volume_musica: z.number().int().min(1).max(100).optional(),
  volume_video: z.number().int().min(0).max(100).optional()
})
export const audioMapFile = z.record(z.string().trim().min(1).max(260), mapEntry)
  .refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 1000, 'O mapa precisa ter de 1 a 1.000 vídeos.')
export interface AudioMapEntry { file: string; query: string; audioVolume: number; videoVolume: number }

export function parseAudioMap(text: string): AudioMapEntry[] {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('O arquivo não é um JSON válido.') }
  const parsed = audioMapFile.safeParse(raw)
  if (!parsed.success) throw new Error('Formato não reconhecido. Use { "video.mp4": { "busca": "artista faixa", "volume_musica": 100, "volume_video": 0 } }.')
  return Object.entries(parsed.data).map(([file, v]) => ({ file, query: v.busca, audioVolume: v.volume_musica ?? DEFAULT_AUDIO_VOLUME, videoVolume: v.volume_video ?? DEFAULT_VIDEO_VOLUME }))
}
/** Matches by file name, ignoring case and folders; the map may list names with or without path. */
export const audioMapKey = (name: string) => name.split(/[\\/]/).pop()!.trim().toLowerCase()

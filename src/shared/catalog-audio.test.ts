import { describe, expect, it } from 'vitest'
import { audioMapKey, catalogAudioChoice, parseAudioMap, sameAudio } from './catalog-audio'

describe('mapa_audios.json', () => {
  it('lê nome do vídeo, busca e volumes, com padrões 100 e 0', () => {
    expect(parseAudioMap(JSON.stringify({
      'IMG_2225_A_clean.mp4': { busca: 'coldplay paradise', volume_musica: 80, volume_video: 10 },
      'IMG_2226.mp4': { busca: 'anitta' }
    }))).toEqual([
      { file: 'IMG_2225_A_clean.mp4', query: 'coldplay paradise', audioVolume: 80, videoVolume: 10 },
      { file: 'IMG_2226.mp4', query: 'anitta', audioVolume: 100, videoVolume: 0 }
    ])
  })
  it('recusa JSON inválido, mapa vazio e volume fora do limite', () => {
    expect(() => parseAudioMap('{')).toThrow(/JSON válido/)
    expect(() => parseAudioMap('{}')).toThrow(/Formato/)
    expect(() => parseAudioMap(JSON.stringify({ 'a.mp4': { busca: 'x', volume_musica: 0 } }))).toThrow(/Formato/)
    expect(() => parseAudioMap(JSON.stringify([{ busca: 'x' }]))).toThrow(/Formato/)
  })
  it('casa nomes sem pasta e sem diferenciar maiúsculas', () => {
    expect(audioMapKey('C:\\videos\\IMG_2225_A_Clean.MP4')).toBe(audioMapKey('img_2225_a_clean.mp4'))
  })
})

describe('escolha de música', () => {
  it('aplica padrões e compara música e volumes', () => {
    const a = catalogAudioChoice.parse({ audioId: '1' })
    expect(a).toEqual({ audioId: '1', audioVolume: 100, videoVolume: 0 })
    expect(sameAudio(a, { ...a })).toBe(true)
    expect(sameAudio(a, { ...a, audioVolume: 90 })).toBe(false)
    expect(sameAudio(null, undefined)).toBe(true)
    expect(sameAudio(a, null)).toBe(false)
  })
})

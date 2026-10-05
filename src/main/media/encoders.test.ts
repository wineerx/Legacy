import { describe, it, expect } from 'vitest'
import { pickH264Encoder, h264Candidates } from './encoders'

const sample = (names: string[]) => names.map((n) => ` V....D ${n}   descrição`).join('\n')

describe('pickH264Encoder', () => {
  it('prefere h264_mf', () => {
    expect(pickH264Encoder(sample(['libopenh264', 'h264_mf']))).toBe('h264_mf')
  })
  it('cai para libopenh264 sem encoders do sistema', () => {
    expect(pickH264Encoder(sample(['libopenh264']))).toBe('libopenh264')
  })
  it('null sem encoder h264', () => {
    expect(pickH264Encoder(sample(['mpeg4']))).toBeNull()
  })
})

describe('h264Candidates', () => {
  it('lista disponíveis em ordem de preferência', () => {
    expect(h264Candidates(sample(['libopenh264', 'h264_nvenc', 'mpeg4', 'h264_mf']))).toEqual(['h264_mf', 'h264_nvenc', 'libopenh264'])
  })
})

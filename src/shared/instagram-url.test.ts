import { describe, it, expect } from 'vitest'
import { normalizeInstagramUrl } from './instagram-url'
import { AppError } from './errors'

describe('normalizeInstagramUrl', () => {
  it.each([
    ['https://www.instagram.com/zanon.boss/', { kind: 'profile', username: 'zanon.boss', url: 'https://www.instagram.com/zanon.boss/' }],
    ['instagram.com/tvred_hot', { kind: 'profile', username: 'tvred_hot', url: 'https://www.instagram.com/tvred_hot/' }],
    ['http://m.instagram.com/tvred_hot?igsh=abc', { kind: 'profile', username: 'tvred_hot', url: 'https://www.instagram.com/tvred_hot/' }],
    ['@Minha.Conta', { kind: 'profile', username: 'minha.conta', url: 'https://www.instagram.com/minha.conta/' }],
    ['https://www.instagram.com/reel/DAbc_12-x/?utm_source=ig', { kind: 'reel', code: 'DAbc_12-x', url: 'https://www.instagram.com/reel/DAbc_12-x/' }],
    ['https://instagram.com/p/CXyz123/', { kind: 'post', code: 'CXyz123', url: 'https://www.instagram.com/p/CXyz123/' }],
    ['https://www.instagram.com/zanon.boss/reel/DAbc_12-x/', { kind: 'reel', code: 'DAbc_12-x', url: 'https://www.instagram.com/reel/DAbc_12-x/' }]
  ])('%s', (input, expected) => {
    expect(normalizeInstagramUrl(input)).toEqual(expected)
  })

  it.each([
    'https://evil.com/instagram.com/x',
    'https://instagram.com.evil.com/x',
    'https://www.instagram.com/explore/',
    'https://www.instagram.com/',
    'ftp://instagram.com/x',
    'https://www.instagram.com/' + 'a'.repeat(31),
    'https://www.instagram.com/nome com espaço',
    'https://www.instagram.com/%E0%A4%A'
  ])('rejeita %s', (input) => {
    expect(() => normalizeInstagramUrl(input)).toThrow(AppError)
  })
})

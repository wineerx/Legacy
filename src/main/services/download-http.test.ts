import { describe, it, expect } from 'vitest'
import { allowedUrl, publicIpv4 } from './download-http'

describe('proteção de downloads', () => {
  it.each(['https://localhost/a', 'http://scontent.cdninstagram.com/a', 'https://cdninstagram.com.evil.test/a', 'https://scontent.cdninstagram.com:8443/a', 'https://user:pass@scontent.cdninstagram.com/a', 'file:///C:/secret', 'https://127.0.0.1/a'])('recusa %s', (url) => expect(() => allowedUrl(url)).toThrow())
  it('aceita só CDN de mídia e separa o host autenticado da API', () => {
    expect(allowedUrl('https://scontent.cdninstagram.com/v.mp4').hostname).toBe('scontent.cdninstagram.com')
    expect(() => allowedUrl('https://api.apify.com/v2/')).toThrow()
    expect(() => allowedUrl('https://scontent.fbcdn.net/a', true)).toThrow()
    expect(allowedUrl('https://api.apify.com/v2/', true).hostname).toBe('api.apify.com')
  })
  it.each(['0.0.0.0', '10.1.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.2', '192.168.1.2', '100.64.1.1', '198.18.1.1', '224.0.0.1', '255.255.255.255', '::1', '203.0.113.1'])('recusa DNS não público %s', (ip) => expect(publicIpv4(ip)).toBe(false))
  it('aceita IPv4 público', () => expect(publicIpv4('8.8.8.8')).toBe(true))
})

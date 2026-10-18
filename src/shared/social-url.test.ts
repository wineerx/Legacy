import { it, expect } from 'vitest'
import { normalizeSocialUrl } from './social-url'
it('normaliza TikTok/Instagram e rejeita hosts, credenciais e redirects ambíguos',()=>{
 expect(normalizeSocialUrl('tiktok.com/@Example/video/123?is_from_webapp=1')).toMatchObject({platform:'tiktok',kind:'reel',code:'123',url:'https://www.tiktok.com/@example/video/123'})
 expect(normalizeSocialUrl('https://tiktok.com/@example')).toMatchObject({kind:'profile',platform:'tiktok'})
 expect(normalizeSocialUrl('instagram.com/example')).toMatchObject({platform:'instagram'})
 expect(()=>normalizeSocialUrl('https://tiktok.com.evil/@example')).toThrow()
 expect(()=>normalizeSocialUrl('https://tiktok.com/@example/live')).toThrow()
})

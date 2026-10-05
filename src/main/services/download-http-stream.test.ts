import { beforeEach, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve4 } from 'node:dns/promises'
import { request } from 'node:https'
import { apifyJson, downloadVideo } from './download-http'

vi.mock('node:dns/promises', () => ({ resolve4: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
let target: string
beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(resolve4).mockResolvedValue(['8.8.8.8'])
  target = join(await mkdtemp(join(tmpdir(), 'legacy-http-')), 'video.mp4')
})

function respond(statusCode: number, headers: Record<string, string>, body: string) {
  vi.mocked(request).mockImplementationOnce(((_url: URL, _options: unknown, callback: (r: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(): void }
    req.end = () => {
      const res = Object.assign(new PassThrough(), { statusCode, headers })
      callback(res)
      res.end(body)
    }
    return req
  }) as typeof request)
}

it('transmite arquivo, fixa DNS validado e não manda token à mídia', async () => {
  respond(200, {}, 'video-content')
  await downloadVideo('https://scontent.cdninstagram.com/v.mp4', target)
  expect(await readFile(target, 'utf8')).toBe('video-content')
  const options = vi.mocked(request).mock.calls[0][1] as { headers: unknown; lookup: Function }
  expect(options.headers).toEqual({})
  const cb = vi.fn()
  options.lookup('ignored', {}, cb)
  expect(cb).toHaveBeenCalledWith(null, '8.8.8.8', 4)
})

it('revalida redirecionamento antes de abrir outra conexão', async () => {
  respond(302, { location: 'https://127.0.0.1/secret' }, '')
  await expect(downloadVideo('https://scontent.cdninstagram.com/v.mp4', target)).rejects.toThrow(/Host/)
  expect(request).toHaveBeenCalledTimes(1)
  await expect(access(target)).rejects.toThrow()
})

it('recusa DNS privado sem conectar', async () => {
  vi.mocked(resolve4).mockResolvedValue(['127.0.0.1'])
  await expect(downloadVideo('https://scontent.cdninstagram.com/v.mp4', target)).rejects.toThrow(/rede/)
  expect(request).not.toHaveBeenCalled()
})

it('recusa comprimento excessivo e remove temporário', async () => {
  respond(200, { 'content-length': String(1024 ** 3 + 1) }, '')
  await expect(downloadVideo('https://scontent.cdninstagram.com/v.mp4', target)).rejects.toThrow(/1 GB/)
  await expect(access(target)).rejects.toThrow()
})

it('recusa redirects da API sem expor o token', async () => {
  respond(302, { location: 'https://scontent.fbcdn.net/secret' }, '')
  await expect(apifyJson('actor-runs/run1', 'secret-token')).rejects.toThrow(/Redirecionamento/)
  expect(request).toHaveBeenCalledTimes(1)
})

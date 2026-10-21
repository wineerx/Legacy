import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shareFile, type FileShare } from './file-share'
import { AppError } from '@shared/errors'

const file = join(mkdtempSync(join(tmpdir(), 'legacy-share-')), 'v.mp4')
writeFileSync(file, Buffer.from('0123456789'))
let share: FileShare | undefined
afterEach(async () => { await share?.close(); share = undefined })
const base = (s: FileShare) => `http://127.0.0.1:${s.port}`

describe('shareFile', () => {
  it('serve só o caminho com token, com tipo e tamanho', async () => {
    share = await shareFile(file)
    expect(share.urlPath).toMatch(/^\/[A-Za-z0-9_-]{43}\/video\.mp4$/)
    const ok = await fetch(base(share) + share.urlPath)
    expect(ok.status).toBe(200); expect(ok.headers.get('content-type')).toBe('video/mp4'); expect(await ok.text()).toBe('0123456789')
    expect((await fetch(base(share) + '/video.mp4')).status).toBe(404)
    expect((await fetch(base(share) + share.urlPath, { method: 'POST' })).status).toBe(404)
  })
  it('responde HEAD e Range', async () => {
    share = await shareFile(file)
    const head = await fetch(base(share) + share.urlPath, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe('10')
    const part = await fetch(base(share) + share.urlPath, { headers: { Range: 'bytes=2-4' } })
    expect(part.status).toBe(206); expect(part.headers.get('content-range')).toBe('bytes 2-4/10'); expect(await part.text()).toBe('234')
    expect((await fetch(base(share) + share.urlPath, { headers: { Range: 'bytes=50-' } })).status).toBe(416)
  })
  it('close libera a porta', async () => {
    share = await shareFile(file); const url = base(share) + share.urlPath
    await share.close(); share = undefined
    await expect(fetch(url)).rejects.toThrow()
  })
  it('rejeita arquivo vazio', async () => {
    const emptyFile = join(mkdtempSync(join(tmpdir(), 'legacy-empty-')), 'empty.mp4')
    writeFileSync(emptyFile, Buffer.alloc(0))
    await expect(shareFile(emptyFile)).rejects.toThrow(AppError)
    const error = await shareFile(emptyFile).catch(e => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('invalid_media')
    rmSync(emptyFile)
  })
  it('close aguarda conexões em pipeline', async () => {
    const largeFile = join(mkdtempSync(join(tmpdir(), 'legacy-large-')), 'large.mp4')
    writeFileSync(largeFile, Buffer.alloc(1024 * 100))
    share = await shareFile(largeFile)
    const url = base(share) + share.urlPath
    const fetchPromise = fetch(url).then(r => r.arrayBuffer()).catch(() => {})
    await share.close()
    share = undefined
    await fetchPromise
    await expect(fetch(url)).rejects.toThrow()
    rmSync(largeFile)
  })
})

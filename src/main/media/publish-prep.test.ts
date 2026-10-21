import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeTestVideo } from './test-fixtures'
import { preparePublishCopy } from './publish-prep'

const dir = mkdtempSync(join(tmpdir(), 'legacy-prep-'))
const input = join(dir, 'in.mp4')
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')
function topBoxes(file: string): string[] {
  const b = readFileSync(file); const out: string[] = []; let i = 0
  while (i + 8 <= b.length) {
    let size = b.readUInt32BE(i); const type = b.toString('latin1', i + 4, i + 8)
    if (size === 1) size = Number(b.readBigUInt64BE(i + 8))
    out.push(type); if (size < 8) break; i += size
  }
  return out
}
beforeAll(async () => { await makeTestVideo(input) })

describe('preparePublishCopy', () => {
  it('gera cópia sem edit lists, moov antes de mdat, sem tocar no original', async () => {
    const before = sha(input)
    const copy = await preparePublishCopy(input, join(dir, 'tmp'))
    const boxes = topBoxes(copy.path)
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'))
    expect(readFileSync(copy.path).includes(Buffer.from('elst'))).toBe(false)
    expect(sha(input)).toBe(before)
    copy.cleanup()
    expect(existsSync(copy.path)).toBe(false)
  })
  it('arquivo que não é vídeo falha de forma definitiva e não deixa cópia parcial', async () => {
    const bad = join(dir, 'not-video.mp4'); writeFileSync(bad, 'isto não é um vídeo')
    const tmp = join(dir, 'tmp-bad')
    await expect(preparePublishCopy(bad, tmp)).rejects.toMatchObject({ code: 'invalid_media', message: 'Não foi possível preparar o vídeo para publicação. Confira se o arquivo é um MP4 válido.' })
    expect(readdirSync(tmp)).toEqual([])
  })
})

import { it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { makeTestVideo } from '../media/test-fixtures'
import { getAsset } from '../repos/assets'
import { parseMediaUrl } from '../media-protocol'
import { importFiles, storedAssetDir } from './library'
import { videoStorage, setVideoStorage } from './storage'

it('alterna pasta sem perder arquivos existentes e isola workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'legacy-storage-'))
  const ctx = { db: memDb(), dataRoot: root, clock: () => new Date() }
  const ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  const ws2 = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  const initial = videoStorage(ctx, ws)
  const custom = await setVideoStorage(ctx, ws, root)
  expect(custom.custom).toBe(true)
  expect(videoStorage(ctx, ws2).custom).toBe(false)
  const source = join(root, 'sample.mp4')
  await makeTestVideo(source)
  const [result] = await importFiles(ctx, ws, [source])
  const asset = getAsset(ctx.db, ws, result.assetId!)!
  expect(asset.filePath.startsWith(custom.path)).toBe(true)
  expect(await setVideoStorage(ctx, ws, null)).toEqual(initial)
  const assetRoot = storedAssetDir(ctx, ws, asset.id)
  expect(assetRoot.startsWith(custom.path)).toBe(true)
  const url = `legacy-media://file/${encodeURIComponent(asset.filePath)}`
  expect(parseMediaUrl(url, root, [assetRoot])).toBe(asset.filePath)
  expect(() => parseMediaUrl(`legacy-media://file/${encodeURIComponent(join(root, 'secret.txt'))}`, root, [assetRoot])).toThrow()
  await expect(setVideoStorage(ctx, 'missing', root)).rejects.toThrow(/Workspace/)
})

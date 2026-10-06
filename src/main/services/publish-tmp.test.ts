import { mkdtempSync, mkdirSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Ctx } from '../context'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { workspaceDir } from '../paths'
import { publishTmpDir, sweepPublishTmp } from './publish-tmp'

let ctx: Ctx
beforeEach(() => { ctx = { db: memDb(), dataRoot: mkdtempSync(join(tmpdir(), 'legacy-sweep-')), clock: () => new Date() } })
afterEach(() => { rmSync(ctx.dataRoot, { recursive: true, force: true }) })

it('apaga sobras de tmp/publish de todos os workspaces e nada fora dele', () => {
  const a = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  const b = createWorkspace(ctx.db, { name: 'B', timeZone: 'UTC' }).id
  createWorkspace(ctx.db, { name: 'Sem pasta', timeZone: 'UTC' })
  for (const ws of [a, b]) {
    const dir = publishTmpDir(ctx, ws); mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'x.mp4'), 'partial'); writeFileSync(join(dir, 'sub', 'y.mp4'), 'partial')
  }
  const keepTmp = join(workspaceDir(ctx.dataRoot, a), 'tmp', 'other.mp4'); writeFileSync(keepTmp, 'keep')
  const keepMedia = join(workspaceDir(ctx.dataRoot, a), 'original.mp4'); writeFileSync(keepMedia, 'keep')
  expect(sweepPublishTmp(ctx)).toBe(4)
  for (const ws of [a, b]) expect(readdirSync(publishTmpDir(ctx, ws))).toEqual([])
  expect(existsSync(keepTmp)).toBe(true); expect(existsSync(keepMedia)).toBe(true)
})
it('sem workspaces ou pastas não falha', () => {
  expect(sweepPublishTmp(ctx)).toBe(0)
})

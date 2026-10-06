import { existsSync, readdirSync, rmSync } from 'node:fs'
import type { Ctx } from '../context'
import { resolveInside, workspaceDir } from '../paths'
import { listWorkspaces } from '../repos/workspaces'

// Temporary remuxed copies served through the tunnel live only here.
export function publishTmpDir(ctx: Pick<Ctx, 'dataRoot'>, workspaceId: string): string {
  return resolveInside(workspaceDir(ctx.dataRoot, workspaceId), 'tmp', 'publish')
}

// Worker start: removes copies left behind by a crash or forced stop. Returns how many entries were removed.
export function sweepPublishTmp(ctx: Pick<Ctx, 'db' | 'dataRoot'>): number {
  let removed = 0
  for (const ws of listWorkspaces(ctx.db)) {
    const dir = publishTmpDir(ctx, ws.id)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      try { rmSync(resolveInside(dir, name), { recursive: true, force: true }); removed++ } catch (e) { console.error('[worker] sweep', e instanceof Error ? e.message : e) }
    }
  }
  return removed
}

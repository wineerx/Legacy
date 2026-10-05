import { mkdir, open, realpath, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { resolveInside, workspaceDir } from '../paths'
import { getSetting, setSetting } from '../repos/settings'
import { listWorkspaces } from '../repos/workspaces'

export function videoStorage(ctx: Ctx, workspaceId: string): { path: string; custom: boolean } {
  if (!listWorkspaces(ctx.db).some((w) => w.id === workspaceId)) throw new AppError('not_found', 'Workspace não encontrado.')
  const custom = getSetting(ctx.db, workspaceId, 'videoStoragePath')
  return { path: custom || resolveInside(workspaceDir(ctx.dataRoot, workspaceId), 'media'), custom: Boolean(custom) }
}

export async function setVideoStorage(ctx: Ctx, workspaceId: string, selected: string | null) {
  videoStorage(ctx, workspaceId)
  const path = selected ? resolveInside(await realpath(selected), 'Legacy', workspaceId, 'media') : resolveInside(workspaceDir(ctx.dataRoot, workspaceId), 'media')
  const testFile = resolveInside(path, `.write-test-${randomUUID()}`)
  try {
    await mkdir(path, { recursive: true })
    const file = await open(testFile, 'wx')
    await file.close()
    await rm(testFile)
  } catch {
    throw new AppError('invalid_input', 'Não foi possível gravar nessa pasta. Escolha uma pasta acessível e com espaço disponível.')
  }
  setSetting(ctx.db, workspaceId, 'videoStoragePath', selected ? path : '')
  return videoStorage(ctx, workspaceId)
}

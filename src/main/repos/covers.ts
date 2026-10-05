import { and, asc, eq } from 'drizzle-orm'
import { copyFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { AppError } from '@shared/errors'
import type { CoverTextSpec } from '@shared/types'
import type { Ctx } from '../context'
import { type Db, newId } from '../db/client'
import { coverTemplates } from '../db/schema'
import { workspaceDir, resolveInside } from '../paths'

export type CoverTemplate = typeof coverTemplates.$inferSelect

export async function createImageCover(ctx: Ctx, ws: string, input: { name: string; imagePath: string }): Promise<CoverTemplate> {
  const ext = extname(input.imagePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) throw new AppError('invalid_input', 'Use uma imagem PNG ou JPG.')
  const id = newId()
  const dir = resolveInside(workspaceDir(ctx.dataRoot, ws), 'covers')
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${id}${ext}`)
  await copyFile(input.imagePath, target)
  return ctx.db.insert(coverTemplates).values({ id, workspaceId: ws, name: input.name.trim() || 'Capa', kind: 'image', imagePath: target, createdAt: ctx.clock().toISOString() }).returning().get()
}

export function createFrameTextCover(ctx: Ctx, ws: string, input: { name: string; frameMs: number; text: CoverTextSpec }): CoverTemplate {
  if (input.frameMs < 0) throw new AppError('invalid_input', 'O frame da capa precisa ser positivo.')
  return ctx.db.insert(coverTemplates).values({
    id: newId(), workspaceId: ws, name: input.name.trim() || 'Capa', kind: 'frame_text', frameMs: input.frameMs,
    textJson: JSON.stringify(input.text), createdAt: ctx.clock().toISOString()
  }).returning().get()
}

export function listCoverTemplates(db: Db, ws: string): CoverTemplate[] {
  return db.select().from(coverTemplates).where(eq(coverTemplates.workspaceId, ws)).orderBy(asc(coverTemplates.createdAt)).all()
}

export function getCoverTemplate(db: Db, ws: string, id: string): CoverTemplate | null {
  return db.select().from(coverTemplates).where(and(eq(coverTemplates.workspaceId, ws), eq(coverTemplates.id, id))).get() ?? null
}

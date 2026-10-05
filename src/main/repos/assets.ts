import { and, desc, eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { mediaAssets, mediaVersions } from '../db/schema'

export type Asset = typeof mediaAssets.$inferSelect
export type AssetVersion = typeof mediaVersions.$inferSelect

const scoped = (ws: string, id: string) => and(eq(mediaAssets.workspaceId, ws), eq(mediaAssets.id, id))

export function insertAsset(db: Db, row: typeof mediaAssets.$inferInsert): Asset {
  return db.insert(mediaAssets).values(row).returning().get()
}
export function getAsset(db: Db, workspaceId: string, id: string): Asset | null {
  return db.select().from(mediaAssets).where(scoped(workspaceId, id)).get() ?? null
}
export function listAssets(db: Db, workspaceId: string): Asset[] {
  return db.select().from(mediaAssets).where(eq(mediaAssets.workspaceId, workspaceId)).orderBy(desc(mediaAssets.importedAt)).all()
}
export function findAssetBySha(db: Db, workspaceId: string, sha256: string): Asset | null {
  return db.select().from(mediaAssets).where(and(eq(mediaAssets.workspaceId, workspaceId), eq(mediaAssets.sha256, sha256))).get() ?? null
}
export function setAssetFavorite(db: Db, workspaceId: string, id: string, favorite: boolean): void {
  db.update(mediaAssets).set({ favorite }).where(scoped(workspaceId, id)).run()
}
export function setAssetThumbnail(db: Db, workspaceId: string, id: string, path: string): void {
  db.update(mediaAssets).set({ thumbnailPath: path }).where(scoped(workspaceId, id)).run()
}
export function deleteAssetRow(db: Db, workspaceId: string, id: string): void {
  db.delete(mediaAssets).where(scoped(workspaceId, id)).run()
}
export function insertVersion(db: Db, row: typeof mediaVersions.$inferInsert): AssetVersion {
  const inserted = db.insert(mediaVersions).values(row).onConflictDoNothing().returning().get()
  return inserted ?? db.select().from(mediaVersions).where(eq(mediaVersions.id, row.id!)).get()!
}
export function listVersions(db: Db, workspaceId: string, assetId: string): AssetVersion[] {
  return db.select().from(mediaVersions)
    .where(and(eq(mediaVersions.workspaceId, workspaceId), eq(mediaVersions.assetId, assetId)))
    .orderBy(desc(mediaVersions.createdAt)).all()
}
export function latestVersion(db: Db, workspaceId: string, assetId: string, kind: AssetVersion['kind']): AssetVersion | null {
  return listVersions(db, workspaceId, assetId).find((v) => v.kind === kind) ?? null
}

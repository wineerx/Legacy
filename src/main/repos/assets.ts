import { and, desc, eq, sql } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { Db } from '../db/client'
import { mediaAssets, mediaVersions, publicationContainerItems as containerItems } from '../db/schema'

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
  db.transaction(tx => {
    if (assetInContainer(tx,workspaceId,id)) throw new AppError('invalid_input','Vídeo em uso por um Container. Remova do rascunho ou cancele os itens pendentes antes de excluir.')
    tx.update(containerItems).set({assetId:null}).where(and(eq(containerItems.workspaceId,workspaceId),eq(containerItems.assetId,id))).run()
    tx.delete(mediaAssets).where(scoped(workspaceId, id)).run()
  },{behavior:'immediate'})
}
export function assetInContainer(db: Db, ws: string, id: string): boolean {
  return Boolean(db.get(sql`select i.id from publication_container_items i join publication_containers c on c.workspace_id=i.workspace_id and c.id=i.container_id
    left join jobs j on j.workspace_id=i.workspace_id and j.id=i.job_id
    where i.workspace_id=${ws} and i.asset_id=${id} and ((c.scheduled_at is null and c.control_state!='cancelled') or j.state in ('queued','running')) limit 1`))
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

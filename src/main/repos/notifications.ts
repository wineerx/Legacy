import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { type Db, newId } from '../db/client'
import { notifications } from '../db/schema'

export type Notification = typeof notifications.$inferSelect

export function addNotification(
  db: Db,
  row: { workspaceId: string; kind: 'info' | 'error' | 'manual_task'; title: string; body: string; actionJson?: string | null; dueAt?: string | null },
  now: Date
): Notification {
  return db.insert(notifications).values({ id: newId(), ...row, actionJson: row.actionJson ?? null, dueAt: row.dueAt ?? null, createdAt: now.toISOString() }).returning().get()
}
const visible = (now: Date) => or(isNull(notifications.dueAt), lte(notifications.dueAt, now.toISOString()))
export function listNotifications(db: Db, ws: string, now: Date): Notification[] {
  return db.select().from(notifications).where(and(eq(notifications.workspaceId, ws), visible(now))).orderBy(desc(notifications.createdAt)).limit(200).all()
}
export function markRead(db: Db, ws: string, id: string, now: Date): void {
  db.update(notifications).set({ readAt: now.toISOString() }).where(and(eq(notifications.workspaceId, ws), eq(notifications.id, id))).run()
}
export function dueUnshown(db: Db, now: Date): Notification[] {
  return db.select().from(notifications).where(and(isNull(notifications.shownAt), isNull(notifications.readAt), visible(now))).orderBy(notifications.createdAt).limit(100).all()
}
export function markAllRead(db: Db, ws: string, now: Date): void {
  db.update(notifications).set({ readAt: now.toISOString() }).where(and(eq(notifications.workspaceId, ws), visible(now))).run()
}
export function markShown(db: Db, id: string, now: Date): void {
  db.update(notifications).set({ shownAt: now.toISOString() }).where(eq(notifications.id, id)).run()
}
export function unreadCount(db: Db, ws: string, now: Date): number {
  return db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.workspaceId, ws), isNull(notifications.readAt), visible(now))).get()!.n
}

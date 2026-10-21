import { and, eq } from 'drizzle-orm'
import type { AgendaItem } from '@shared/agenda'
import type { Ctx } from '../context'
import { destinationAccounts } from '../db/schema'
import { containersInRange } from '../repos/publication-containers'
import { getWorkspace } from '../repos/workspaces'
import { requireWorkspace } from './integrations'
import { instagramAccount } from './instagram-publishing'
import { withEstimate } from './container-window'

/** A bounded read for the Agenda: one entry per Container, never per job. */
export const AGENDA_LIMIT = 500
export function readAgenda(ctx: Ctx, ws: string, input: { from: string; to: string; accountId?: string }) {
  requireWorkspace(ctx, ws)
  const { items, truncated } = containersInRange(ctx.db, ws, ctx.clock(), { ...input, limit: AGENDA_LIMIT })
  const names = new Map(ctx.db.select({ id: destinationAccounts.providerId, username: destinationAccounts.username }).from(destinationAccounts)
    .where(and(eq(destinationAccounts.workspaceId, ws), eq(destinationAccounts.provider, 'instagram'))).all().map(a => [a.id, a.username]))
  const username = (id: string | null) => !id ? null : names.get(id) ?? (instagramAccount(ctx, ws, id)?.id === id ? instagramAccount(ctx, ws, id)!.username : null)
  return { timeZone: getWorkspace(ctx.db, ws)!.timeZone, truncated,
    items: items.map((c): AgendaItem => ({ ...withEstimate(ctx, ws, c), username: username(c.destinationAccountId) })) }
}

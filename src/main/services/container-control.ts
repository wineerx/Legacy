import { and, eq, sql } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { publishUncertain, type PublicationCheckpoint } from '@shared/publication-containers'
import { jobs, publicationContainers as containers, publicationContainerItems as items } from '../db/schema'
import type { Db } from '../db/client'

export function publicationControl(db: Db, ws: string, jobId: string): 'active' | 'paused' | 'cancelled' {
  return db.select({ control: containers.controlState }).from(items).innerJoin(containers,
    and(eq(containers.workspaceId, items.workspaceId), eq(containers.id, items.containerId)))
    .where(and(eq(items.workspaceId, ws), eq(items.jobId, jobId))).get()?.control ?? 'active'
}
export function isContainerJob(db: Db, ws: string, jobId: string): boolean {
  return Boolean(db.select({id:items.id}).from(items).where(and(eq(items.workspaceId,ws),eq(items.jobId,jobId))).get())
}
// Queued jobs can also be polls. Permit them while paused/cancelled only with a durable remote checkpoint.
export const containerClaimGate = sql`not exists (
  select 1 from publication_container_items ci join publication_containers pc on pc.workspace_id=ci.workspace_id and pc.id=ci.container_id
  where ci.workspace_id=jobs.workspace_id and ci.job_id=jobs.id and pc.control_state!='active'
  and not (coalesce(json_extract(jobs.result_json,'$.creating'),0)=1 or json_extract(jobs.result_json,'$.containerId') is not null
    or coalesce(json_extract(jobs.result_json,'$.publishing'),0)=1 or json_extract(jobs.result_json,'$.mediaId') is not null)
)`
/** A process may die after cancellation but before observing the gate. No remote intent means no reconciliation. */
export function settleCancelledContainers(db: Db, now: Date) {
  db.update(jobs).set({state:'cancelled',leaseUntil:null,updatedAt:now.toISOString()}).where(and(eq(jobs.state,'queued'),
    sql`exists(select 1 from publication_container_items ci join publication_containers pc on pc.workspace_id=ci.workspace_id and pc.id=ci.container_id
      where ci.workspace_id=jobs.workspace_id and ci.job_id=jobs.id and pc.control_state='cancelled')`,
    sql`coalesce(json_extract(${jobs.resultJson},'$.creating'),0)!=1 and json_extract(${jobs.resultJson},'$.containerId') is null
      and coalesce(json_extract(${jobs.resultJson},'$.publishing'),0)!=1 and json_extract(${jobs.resultJson},'$.mediaId') is null`)).run()
}
export class ContainerHeld extends Error {
  constructor(public control: 'paused' | 'cancelled') { super(`Container ${control}`) }
}
export function assertNewPublicationAllowed(db: Db, ws: string, jobId: string) {
  const control = publicationControl(db, ws, jobId)
  if (control !== 'active') throw new ContainerHeld(control)
}
export function assertContainerRetryAllowed(db: Db, ws: string, jobId: string, checkpoint: PublicationCheckpoint) {
  if (publicationControl(db, ws, jobId) === 'cancelled' && !publishUncertain(checkpoint)) {
    throw new AppError('invalid_input', 'Container cancelado. Crie uma nova intenção após revisar o destino.')
  }
}

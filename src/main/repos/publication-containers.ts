import { and, eq, asc, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import { projectContainerState, type ContainerDetail, type ContainerPage, type PublicationContainerState, type PublicationContainer } from '@shared/publication-containers'
import { publicationContainers as containers, publicationContainerItems as items, jobs, publicationHistory } from '../db/schema'
import type { Db } from '../db/client'

export const containerScope = (ws: string, id: string) => and(eq(containers.workspaceId, ws), eq(containers.id, id))
export function containerRow(db: Db, ws: string, id: string) {
  const row = db.select().from(containers).where(containerScope(ws, id)).get()
  if (!row) throw new AppError('not_found', 'Container não encontrado neste workspace.')
  return row
}
export function containerItems(db: Db, ws: string, id: string) {
  return db.select().from(items).where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).orderBy(asc(items.position)).all()
}
type Counts = PublicationContainer['counts'] & { id: string; firstStartedAt: string | null; lastConfirmedAt: string | null; state: PublicationContainerState }
// One aggregate per Container, including all items. State filtering happens in SQL before pagination.
function summarySql(ws: string, now: string, id?: string): SQL {
  return sql`with attempts as (
    select a.job_id, min(a.started_at) as first_at from job_attempts a join jobs j on j.id=a.job_id
    where j.workspace_id=${ws} group by a.job_id
  ), totals as (
    select c.id, c.scheduled_at, c.control_state, c.created_at,
    count(i.id) as total,
    sum(case when h.job_id is not null then 1 else 0 end) as confirmed,
    sum(case when j.state='queued' then 1 else 0 end) as pending,
    sum(case when j.state='running' then 1 else 0 end) as running,
    sum(case when j.state='failed' then 1 else 0 end) as failed,
    sum(case when j.state='cancelled' then 1 else 0 end) as cancelled,
    sum(case when j.state in ('done','failed','cancelled') then 1 else 0 end) as terminal,
    sum(case when a.first_at is not null or j.state in ('running','done','failed','cancelled') then 1 else 0 end) as started,
    sum(case when j.state in ('queued','running') and (json_extract(j.result_json,'$.creating')=1 or json_extract(j.result_json,'$.containerId') is not null or json_extract(j.result_json,'$.publishing')=1 or json_extract(j.result_json,'$.mediaId') is not null) then 1 else 0 end) as remoteOpen,
    sum(case when j.state='queued' and exists(select 1 from provider_limits l where l.workspace_id=c.workspace_id and l.provider=c.provider and l.account_id=c.destination_account_id and l.operation='publication_quota' and l.cooldown_until>${now}) then 1 else 0 end) as waitingQuota,
    min(a.first_at) as firstStartedAt, max(h.published_at) as lastConfirmedAt
    from publication_containers c
    left join publication_container_items i on i.workspace_id=c.workspace_id and i.container_id=c.id
    left join jobs j on j.workspace_id=i.workspace_id and j.id=i.job_id
    left join publication_history h on h.workspace_id=i.workspace_id and h.job_id=i.job_id
    left join attempts a on a.job_id=j.id
    where c.workspace_id=${ws} ${id ? sql`and c.id=${id}` : sql``} group by c.id
  ) select *, case when control_state='cancelled' then 'cancelled' when scheduled_at is null then 'draft'
    when total>0 and confirmed=total then 'completed' when total>0 and terminal=total then 'completed_with_failures'
    when control_state='paused' then 'paused' when started>0 then 'in_progress' else 'scheduled' end as state from totals`
}
function dto(row: typeof containers.$inferSelect, stats: Counts): PublicationContainer {
  const { total, confirmed, pending, running, failed, cancelled, terminal, started, remoteOpen, waitingQuota } = stats
  const counts = { total, confirmed, pending, running, failed, cancelled, terminal, started, remoteOpen, waitingQuota }
  return { id: row.id, workspaceId: row.workspaceId, name: row.name, revision: row.revision, provider: row.provider,
    destinationAccountId: row.destinationAccountId, accountRevision: row.accountRevision, timeZone: row.timeZone,
    plannedStartAt: row.plannedStartAt, plannedEndAt: row.plannedEndAt, intervalMin: row.intervalMin, trialGraduation: row.trialGraduation ?? null,
    captionBase: row.captionBase, visualSnapshot: JSON.parse(row.visualSnapshotJson), scheduledAt: row.scheduledAt,
    controlState: row.controlState, state: projectContainerState(Boolean(row.scheduledAt), row.controlState, counts), counts,
    plannedDurationMin: row.plannedStartAt && row.plannedEndAt ? (Date.parse(row.plannedEndAt)-Date.parse(row.plannedStartAt))/60000 : null,
    estimatedEndAt: null, delayMin: null, quotaDemand: total, quotaTotal: null, quotaAvailable: null,
    firstStartedAt: stats.firstStartedAt, lastConfirmedAt: stats.lastConfirmedAt, createdAt: row.createdAt, updatedAt: row.updatedAt }
}
export function getContainer(db: Db, ws: string, id: string, now: Date, page = 1, pageSize = 50): ContainerDetail {
  const row = containerRow(db, ws, id)
  const stats = db.get<Counts>(summarySql(ws, now.toISOString(), id))!
  const pageItems = db.select({ item: items, jobState: jobs.state, confirmed: publicationHistory.jobId }).from(items)
    .leftJoin(jobs, and(eq(jobs.workspaceId, items.workspaceId), eq(jobs.id, items.jobId)))
    .leftJoin(publicationHistory, and(eq(publicationHistory.workspaceId, items.workspaceId), eq(publicationHistory.jobId, items.jobId)))
    .where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).orderBy(asc(items.position)).limit(pageSize).offset((page-1)*pageSize).all()
  return { container: dto(row, stats), total: stats.total, page, pageSize, items: pageItems.map(({ item, jobState, confirmed }) => ({
    id: item.id, position: item.position, assetId: item.assetId, source: JSON.parse(item.sourceSnapshotJson),
    captionOverride: item.captionOverride, plannedPublishAt: item.plannedPublishAt, recipeVersionId: item.recipeVersionId,
    jobId: item.jobId, jobState, confirmed: Boolean(confirmed), effectiveCaption: item.effectiveSnapshotJson ? JSON.parse(item.effectiveSnapshotJson).caption : null,
    shareToFeed: item.shareToFeed, allowRepost: item.allowRepost
  })) }
}
export function queryContainers(db: Db, ws: string, now: Date, input: { page: number; pageSize: number; state?: PublicationContainerState; states?: PublicationContainerState[]; destinationAccountId?: string }): ContainerPage {
  const base = summarySql(ws, now.toISOString())
  const filter = sql`where 1=1 ${input.state ? sql`and s.state=${input.state}` : sql``} ${input.states?.length ? sql`and s.state in (${sql.join(input.states.map(v => sql`${v}`), sql`,`)})` : sql``} ${input.destinationAccountId ? sql`and exists(select 1 from publication_containers c where c.id=s.id and c.workspace_id=${ws} and c.destination_account_id=${input.destinationAccountId})` : sql``}`
  const total = db.get<{ n: number }>(sql`select count(*) as n from (${base}) s ${filter}`)!.n
  const summaries = db.all<Counts>(sql`select * from (${base}) s ${filter} order by s.created_at desc,s.id limit ${input.pageSize} offset ${(input.page-1)*input.pageSize}`)
  const rows = summaries.length ? db.select().from(containers).where(and(eq(containers.workspaceId, ws), inArray(containers.id, summaries.map(s => s.id)))).all() : []
  const byId = new Map(rows.map(r => [r.id, r]))
  return { items: summaries.map(s => dto(byId.get(s.id)!, s)), total, page: input.page, pageSize: input.pageSize }
}
/** Containers whose planned window touches [from, to), cancelled ones excluded; ordered by start. */
export function containersInRange(db: Db, ws: string, now: Date, input: { from: string; to: string; accountId?: string; limit: number }) {
  const ids = db.select({ id: containers.id }).from(containers).where(and(eq(containers.workspaceId, ws), isNotNull(containers.plannedStartAt),
    sql`${containers.plannedStartAt} < ${input.to}`, sql`coalesce(${containers.plannedEndAt}, ${containers.plannedStartAt}) >= ${input.from}`,
    ne(containers.controlState, 'cancelled'), input.accountId ? eq(containers.destinationAccountId, input.accountId) : undefined))
    .orderBy(asc(containers.plannedStartAt), asc(containers.id)).limit(input.limit + 1).all().map(r => r.id)
  if (!ids.length) return { items: [] as PublicationContainer[], truncated: false }
  const page = ids.slice(0, input.limit)
  const summaries = db.all<Counts>(sql`select * from (${summarySql(ws, now.toISOString())}) s where s.id in (${sql.join(page.map(id => sql`${id}`), sql`,`)})`)
  const rows = new Map(db.select().from(containers).where(and(eq(containers.workspaceId, ws), inArray(containers.id, page))).all().map(r => [r.id, r]))
  const byId = new Map(summaries.map(s => [s.id, s]))
  return { items: page.map(id => dto(rows.get(id)!, byId.get(id)!)), truncated: ids.length > input.limit }
}

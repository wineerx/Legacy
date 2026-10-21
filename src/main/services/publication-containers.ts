import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { containerDraftInput, publishUncertain, type ContainerDraftInput, type PublicationContainerState } from '@shared/publication-containers'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { jobs, destinationAccounts, publicationContainers as containers, publicationContainerItems as items } from '../db/schema'
import { getRemotePost } from '../repos/remote-posts'
import { getAsset } from '../repos/assets'
import { getWorkspace } from '../repos/workspaces'
import { containerItems, containerRow, containerScope, getContainer, queryContainers } from '../repos/publication-containers'
import { getTemplate } from '../repos/visual-templates'
import { assertScheduleQuota } from './instagram-quota'
import { requireWorkspace } from './integrations'
import { scheduleCompositionRaw, instagramAccount } from './instagram-publishing'
import { getSetting, setSetting } from '../repos/settings'
import { releaseExposure } from './media-host/registry'
import { planContainerVisual, visualHash } from './container-visual'
import { containerVisualSnapshot, hasContainerVisual } from '@shared/container-visual'

const immediate = { behavior: 'immediate' } as const
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function revision(row: typeof containers.$inferSelect, expected: number) {
  if (row.revision !== expected) throw new AppError('invalid_input', 'O Container mudou. Atualize antes de confirmar.')
}
/**
 * The editor copies a Template locally so it can be adjusted before the first save. A new or changed
 * origin is verified here, inside the draft transaction: the version must exist in this workspace,
 * still be active, and carry the declared name. Adjusted values stay allowed; the snapshot is a copy.
 */
function assertTemplateSource(ctx: Ctx, ws: string, id: string, value: z.output<typeof containerDraftInput>) {
  const source = value.visualSnapshot.version === 2 ? value.visualSnapshot.source : undefined
  if (!source) return
  const stored = ctx.db.select({ json: containers.visualSnapshotJson }).from(containers).where(containerScope(ws, id)).get()
  const previous = stored ? containerVisualSnapshot.safeParse(JSON.parse(stored.json)) : null
  const before = previous?.success && previous.data.version === 2 ? previous.data.source : undefined
  if (before && before.templateId === source.templateId && before.templateVersion === source.templateVersion) return
  const template = getTemplate(ctx.db, ws, source.templateId, source.templateVersion).template
  if (template.status !== 'active') throw new AppError('invalid_input', 'Template arquivado não pode ser aplicado novamente.')
  if (template.name !== source.templateName) throw new AppError('invalid_input', 'A origem do Template não confere. Aplique o Template novamente.')
}
function saveDraft(ctx: Ctx, ws: string, id: string, value: z.output<typeof containerDraftInput>) {
  const now = ctx.clock().toISOString()
  assertTemplateSource(ctx, ws, id, value)
  if (value.destinationAccountId && !ctx.db.select().from(destinationAccounts).where(and(eq(destinationAccounts.workspaceId,ws),eq(destinationAccounts.provider,'instagram'),eq(destinationAccounts.providerId,value.destinationAccountId))).get()) {
    // Older installations can still have only the compatibility account. Register that same
    // identity and copy its encrypted token in the transaction; never adopt legacy batches/jobs.
    const legacy=instagramAccount(ctx,ws,value.destinationAccountId), encrypted=getSetting(ctx.db,ws,'secret.instagramToken')
    if (!legacy || !encrypted || (value.accountRevision && legacy.revision!==value.accountRevision)) throw new AppError('invalid_input','O destino mudou. Atualize e revise a conta antes de confirmar.')
    if (getSetting(ctx.db,ws,`secret.instagramToken:${legacy.id}`)) throw new AppError('invalid_input','Reconecte este destino antes de criar o Container.')
    setSetting(ctx.db,ws,`secret.instagramToken:${legacy.id}`,encrypted)
    ctx.db.insert(destinationAccounts).values({workspaceId:ws,provider:'instagram',providerId:legacy.id,username:legacy.username,revision:legacy.revision,validatedAt:legacy.validatedAt}).run()
  }
  const seen = new Set<string>()
  const rows = value.items.map((item, position) => {
    if (seen.has(item.assetId) && !item.allowRepost) throw new AppError('duplicate', 'Possível repostagem: confirme a repetição intencional deste vídeo no Container.')
    seen.add(item.assetId)
    const asset = getAsset(ctx.db, ws, item.assetId)
    if (!asset) throw new AppError('not_found', 'Vídeo não encontrado neste workspace.')
    if (item.sourcePostId && getRemotePost(ctx.db,ws,item.sourcePostId)?.assetId !== asset.id) throw new AppError('invalid_input','Origem inválida para este vídeo.')
    return { id: newId(), workspaceId: ws, containerId: id, position, assetId: asset.id,
      sourceSnapshotJson: JSON.stringify({ name: asset.sourceName, sha256: asset.sha256, origin: asset.origin, postId:item.sourcePostId }),
      captionOverride: item.captionOverride, recipeVersionId: item.recipeVersionId ?? null,
      shareToFeed: item.shareToFeed, allowRepost: item.allowRepost, createdAt: now, updatedAt: now }
  })
  ctx.db.delete(items).where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).run()
  // Stay below SQLite's variable limit, while avoiding an INSERT round trip per item.
  for (let i=0; i<rows.length; i+=50) ctx.db.insert(items).values(rows.slice(i,i+50)).run()
  const start = value.plannedStartAt ? new Date(value.plannedStartAt).toISOString() : null
  ctx.db.update(containers).set({ name: value.name, provider: value.provider, destinationAccountId: value.destinationAccountId,
    accountRevision: value.accountRevision, timeZone: value.timeZone ?? getWorkspace(ctx.db, ws)!.timeZone,
    plannedStartAt: start, plannedEndAt: start && rows.length ? new Date(Date.parse(start)+(rows.length-1)*value.intervalMin*60000).toISOString() : null,
    intervalMin: value.intervalMin, trialGraduation: value.trialGraduation, captionBase: value.captionBase, visualSnapshotJson: JSON.stringify(value.visualSnapshot), updatedAt: now
  }).where(containerScope(ws, id)).run()
}
function createDraft(ctx: Ctx, ws: string, requestId: string, value: z.output<typeof containerDraftInput>, technicalBatchId?: string) {
  const hash = fingerprint(value)
  const previous = ctx.db.select().from(containers).where(and(eq(containers.workspaceId, ws), eq(containers.requestId, requestId))).get()
  if (previous) {
    if (previous.requestFingerprint !== hash) throw new AppError('duplicate', 'Esta chave de criação já foi usada com outra configuração.')
    return previous.id
  }
  const id = newId(), now = ctx.clock().toISOString()
  ctx.db.insert(containers).values({ id, workspaceId: ws, requestId, requestFingerprint: hash,
    technicalBatchId, name: value.name, timeZone: value.timeZone ?? getWorkspace(ctx.db, ws)!.timeZone, createdAt: now, updatedAt: now }).run()
  saveDraft(ctx, ws, id, value)
  return id
}
export function createContainer(ctx: Ctx, ws: string, requestId: string, input: ContainerDraftInput) {
  requireWorkspace(ctx, ws)
  const value = containerDraftInput.parse(input)
  z.uuid().parse(requestId)
  return ctx.db.transaction(() => getContainer(ctx.db, ws, createDraft(ctx, ws, requestId, value), ctx.clock()), immediate)
}
export function updateContainerDraft(ctx: Ctx, ws: string, id: string, expectedRevision: number, input: ContainerDraftInput) {
  requireWorkspace(ctx, ws)
  const value = containerDraftInput.parse(input)
  return ctx.db.transaction(() => {
    const row = containerRow(ctx.db, ws, id); revision(row, expectedRevision)
    if (row.scheduledAt || row.controlState !== 'active') throw new AppError('invalid_input', 'Somente rascunhos ativos podem ser editados.')
    saveDraft(ctx, ws, id, value)
    ctx.db.update(containers).set({ revision: row.revision+1 }).where(containerScope(ws, id)).run()
    return getContainer(ctx.db, ws, id, ctx.clock())
  }, immediate)
}
export function readContainer(ctx: Ctx, ws: string, id: string, page = 1, pageSize = 50) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => getContainer(ctx.db, ws, id, ctx.clock(), page, pageSize))
}
export function listContainers(ctx: Ctx, ws: string, input: { page: number; pageSize: number; state?: PublicationContainerState; states?: PublicationContainerState[]; destinationAccountId?: string }) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => queryContainers(ctx.db, ws, ctx.clock(), input))
}
function jobViews(ctx: Ctx, ws: string, id: string): JobView[] {
  return ctx.db.select({ id: jobs.id, workspaceId: jobs.workspaceId, type: jobs.type, state: jobs.state, attempts: jobs.attempts,
    maxAttempts: jobs.maxAttempts, runAt: jobs.runAt, lastError: jobs.lastError, label: jobs.label, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt })
    .from(items).innerJoin(jobs, and(eq(jobs.workspaceId, items.workspaceId), eq(jobs.id, items.jobId)))
    .where(and(eq(items.workspaceId, ws), eq(items.containerId, id))).orderBy(items.position).all() as JobView[]
}
function schedule(ctx: Ctx, ws: string, id: string, expectedRevision: number, slots?: string[]) {
  const row = containerRow(ctx.db, ws, id)
  if (row.scheduledAt) {
    if (row.scheduledRevision !== expectedRevision || row.controlState === 'cancelled') throw new AppError('invalid_input', 'O Container já foi agendado ou cancelado. Atualize antes de confirmar.')
    return jobViews(ctx, ws, id)
  }
  revision(row, expectedRevision)
  const content = containerItems(ctx.db, ws, id)
  if (row.controlState !== 'active' || !content.length || !row.destinationAccountId || !row.accountRevision || !row.plannedStartAt) throw new AppError('invalid_input', 'Informe vídeos, conta, revisão do destino e início antes de agendar.')
  const orderedSlots = content.map((_, i) => slots?.[i] ?? new Date(Date.parse(row.plannedStartAt!)+i*row.intervalMin*60000).toISOString())
  if (slots && slots.length !== content.length) throw new AppError('invalid_input', 'Quantidade de horários inválida.')
  const result: JobView[] = []
  const visual = containerVisualSnapshot.parse(JSON.parse(row.visualSnapshotJson))
  for (const [i, item] of content.entries()) {
    if (!item.assetId) throw new AppError('not_found', 'Vídeo não encontrado.')
    const caption = item.captionOverride ?? row.captionBase
    const sourcePostId = JSON.parse(item.sourceSnapshotJson).postId as string | undefined
    const recipeVersionId = planContainerVisual(ctx, ws, id, item.assetId, visual, item.recipeVersionId ?? undefined, caption)
    const [job] = scheduleCompositionRaw(ctx, ws, { batchId: row.technicalBatchId ?? id, assetIds: [item.assetId], accountId: row.destinationAccountId,
      accountRevision: row.accountRevision, firstAt: orderedSlots[i], intervalMin: row.intervalMin, captions: { [item.assetId]: caption },
      versionIds: recipeVersionId ? { [item.assetId]: recipeVersionId } : undefined,
      cleanupAfterPublish: false, shareToFeed: item.shareToFeed, allowRepost: item.allowRepost, freshOnly:true, trialGraduation: row.trialGraduation ?? undefined,
      sourcePostIds: sourcePostId ? { [item.assetId]:sourcePostId } : undefined })
    const existing = ctx.db.select().from(items).where(eq(items.jobId, job.id)).get()
    const jobRow = ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))).get()!
    if (existing || JSON.parse(jobRow.payloadJson).batchId !== (row.technicalBatchId ?? id)) throw new AppError('duplicate', 'Esta intenção já pertence a outro Container ou lote legado.')
    ctx.db.update(jobs).set({ payloadJson: JSON.stringify({ ...JSON.parse(jobRow.payloadJson), publicationContainerId: id }) }).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))).run()
    ctx.db.update(items).set({ jobId: job.id, plannedPublishAt: orderedSlots[i], effectiveSnapshotJson: JSON.stringify({ caption, recipeVersionId: recipeVersionId ?? null, trialGraduation: row.trialGraduation ?? null,
      shareToFeed: item.shareToFeed, allowRepost: item.allowRepost, visual: hasContainerVisual(visual) ? { containerId: id, sha256: visualHash(visual) } : visual }), updatedAt: ctx.clock().toISOString() })
      .where(and(eq(items.workspaceId, ws), eq(items.id, item.id))).run()
    result.push(job)
  }
  assertScheduleQuota(ctx, ws, row.destinationAccountId, result.map(job => job.id), row.timeZone)
  const bounds = [...orderedSlots].sort()
  ctx.db.update(containers).set({ scheduledAt: ctx.clock().toISOString(), scheduledRevision: expectedRevision, revision: row.revision+1,
    plannedStartAt: bounds[0], plannedEndAt: bounds.at(-1), updatedAt: ctx.clock().toISOString() }).where(containerScope(ws, id)).run()
  return result
}
export function scheduleContainer(ctx: Ctx, ws: string, id: string, expectedRevision: number) {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => {
    const scheduled = schedule(ctx, ws, id, expectedRevision)
    return { detail: getContainer(ctx.db, ws, id, ctx.clock()), jobs: scheduled }
  }, immediate)
}

export type ContainerIntent = { media: string; provider: 'instagram'; destinationAccount: string; accountRevision: string; publishAt: string; caption: string; versionId?: string; sourcePostId?: string; shareToFeed: boolean; allowRepost: boolean }
export function scheduleContainerIntents(ctx: Ctx, ws: string, intents: ContainerIntent[], technicalBatchId?: string, intervalMin = 15): JobView[] {
  requireWorkspace(ctx, ws)
  if (!intents.length || intents.length>1000) throw new AppError('invalid_input', 'Selecione de 1 a 1.000 vídeos.')
  return ctx.db.transaction(() => {
    const grouped = new Map<string, ContainerIntent[]>()
    for (const intent of intents) {
      const key = `${intent.provider}:${intent.destinationAccount}`
      grouped.set(key, [...(grouped.get(key) ?? []), intent])
    }
    const result = new Map<string, JobView[]>()
    for (const [key, group] of grouped) {
      if (group.some(v => v.accountRevision !== group[0].accountRevision)) throw new AppError('invalid_input', 'Revisões de destino divergentes.')
      const value = containerDraftInput.parse({ name: `Publicações Instagram · ${group[0].destinationAccount}`, provider: 'instagram',
        destinationAccountId: group[0].destinationAccount, accountRevision: group[0].accountRevision, plannedStartAt: group[0].publishAt, intervalMin,
        items: group.map(v => ({ assetId: v.media, captionOverride: v.caption, sourcePostId:v.sourcePostId, recipeVersionId: v.versionId, shareToFeed: v.shareToFeed, allowRepost: v.allowRepost })) })
      const request = technicalBatchId ? `batch:${technicalBatchId}:${key}` : `adapter:${fingerprint(group)}`
      const previous = ctx.db.select().from(containers).where(and(eq(containers.workspaceId, ws), eq(containers.requestId, request))).get()
      const adapterHash = fingerprint({ value, slots: group.map(v => v.publishAt) })
      if (previous && previous.requestFingerprint !== adapterHash) throw new AppError('duplicate', 'Este lote já possui outra configuração.')
      const id = previous?.id ?? createDraft(ctx, ws, request, value, technicalBatchId)
      if (!previous) ctx.db.update(containers).set({ requestFingerprint: adapterHash }).where(containerScope(ws, id)).run()
      const row = containerRow(ctx.db, ws, id)
      result.set(key, schedule(ctx, ws, id, row.scheduledRevision ?? row.revision, group.map(v => new Date(v.publishAt).toISOString())))
    }
    const offsets = new Map<string, number>()
    return intents.map(v => { const key=`${v.provider}:${v.destinationAccount}`, offset=offsets.get(key) ?? 0; offsets.set(key,offset+1); return result.get(key)![offset] })
  }, immediate)
}
export function setContainerControl(ctx: Ctx, ws: string, id: string, expectedRevision: number, control: 'paused' | 'active') {
  requireWorkspace(ctx, ws)
  return ctx.db.transaction(() => {
    const row = containerRow(ctx.db, ws, id); revision(row, expectedRevision)
    const current = getContainer(ctx.db, ws, id, ctx.clock()).container
    if (!row.scheduledAt || row.controlState === 'cancelled' || ['completed','completed_with_failures'].includes(current.state)) throw new AppError('invalid_input', 'Somente Containers agendados com itens pendentes podem ser pausados ou retomados.')
    ctx.db.update(containers).set({ controlState: control, revision: row.revision+1, updatedAt: ctx.clock().toISOString() }).where(containerScope(ws, id)).run()
    return getContainer(ctx.db, ws, id, ctx.clock())
  }, immediate)
}
export async function cancelContainer(ctx: Ctx, ws: string, id: string, expectedRevision: number) {
  requireWorkspace(ctx, ws)
  const releases: string[] = []
  ctx.db.transaction(() => {
    const row = containerRow(ctx.db, ws, id); revision(row, expectedRevision)
    ctx.db.update(containers).set({ controlState: 'cancelled', revision: row.revision+1, updatedAt: ctx.clock().toISOString() }).where(containerScope(ws, id)).run()
    const linked = ctx.db.select({ job: jobs }).from(items).innerJoin(jobs, and(eq(jobs.workspaceId, items.workspaceId), eq(jobs.id, items.jobId)))
      .where(and(eq(items.workspaceId, ws), eq(items.containerId, id), inArray(jobs.state, ['queued','failed']))).all()
    for (const { job } of linked) {
      const checkpoint = JSON.parse(job.resultJson ?? '{}')
      if (publishUncertain(checkpoint) || (checkpoint.creating && !checkpoint.containerId)) continue
      ctx.db.update(jobs).set({ state: 'cancelled', leaseUntil: null, updatedAt: ctx.clock().toISOString() }).where(and(eq(jobs.workspaceId, ws), eq(jobs.id, job.id))).run()
      releases.push(job.id)
    }
  }, immediate)
  await Promise.all(releases.map(id => releaseExposure(id).catch(() => {})))
  return readContainer(ctx, ws, id)
}

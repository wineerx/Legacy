import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import type { Ctx } from '../context'
import { memDb, MIGRATIONS_DIR } from '../test-utils'
import { openDb } from '../db/client'
import { jobs, settings, destinationAccounts, publicationContainers as containers, publicationContainerItems as items, publicationHistory } from '../db/schema'
import { getSetting } from '../repos/settings'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset, deleteAssetRow } from '../repos/assets'
import { createContainer, updateContainerDraft, readContainer, listContainers, scheduleContainer, setContainerControl, cancelContainer } from './publication-containers'
import { connectInstagram, publishInstagram, scheduleComposition, schedulePublicationBatch, InstagramPending, type PublishDeps } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { leaseNext, complete, fail, deferJob, recoverExpired, retryNow, reschedule, enqueue, ownedJob } from '../queue/queue'
import { deferPublicationAccount } from './instagram-publication-limit'
import { releaseAll } from './media-host/registry'
import { ContainerHeld } from './container-control'
import { holdContainerJob } from './container-job-hold'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'
import { zonedToUtc } from '@shared/schedule'
import { containerDraftInput, projectContainerState, type ContainerCounts } from '@shared/publication-containers'
import * as instagram from './instagram-publishing'
import { processNext } from '../worker/handlers'

const vault = { available:()=>true, encrypt:(s:string)=>`protected:${s}`, decrypt:(s:string)=>s.slice(10) }
let ctx: Ctx, ws: string, now: Date, root: string, asset: string, accountRevision: string, deps: PublishDeps
beforeEach(async () => {
  root=mkdtempSync(join(tmpdir(),'legacy-containers-'))
  now=new Date('2026-10-09T15:00:00.000Z')
  ctx={ db:memDb(), dataRoot:root, clock:()=>now }
  ws=createWorkspace(ctx.db,{name:'A',timeZone:'America/Sao_Paulo'}).id
  ctx.secret=(workspace,key)=>decryptSecret(ctx,vault,workspace,key)
  accountRevision=(await connectInstagram(ctx,vault,ws,'synthetic-a',vi.fn().mockResolvedValue({user_id:'111',id:'111',username:'a'}))).revision
  asset=addAsset('first')
  deps={host:{id:'cloudflare-quick-tunnel',expose:vi.fn().mockResolvedValue({url:'https://synthetic.invalid/video.mp4',release:vi.fn().mockResolvedValue(undefined)})},prepare:vi.fn().mockImplementation(async path=>({path,cleanup:vi.fn()}))}
})
afterEach(async()=>{await releaseAll();rmSync(root,{recursive:true,force:true})})
function addAsset(id: string) {
  const file=join(root,`${id}.mp4`);writeFileSync(file,'synthetic media')
  return insertAsset(ctx.db,{id,workspaceId:ws,origin:'pc',sourceName:`${id}.mp4`,filePath:file,sha256:`sha-${id}`,sizeBytes:15,durationMs:2000,width:720,height:1280,videoCodec:'h264',validationJson:'{}',importedAt:now.toISOString()}).id
}
function draft(ids=[asset], extra: Partial<Parameters<typeof createContainer>[3]>={}) {
  return createContainer(ctx,ws,randomUUID(),{name:'Lote teste',provider:'instagram',destinationAccountId:'111',accountRevision,
    plannedStartAt:'2026-10-09T16:00:00.000Z',intervalMin:15,items:ids.map(assetId=>({assetId})),...extra})
}
function planned(ids=[asset]) {
  const d=draft(ids), result=scheduleContainer(ctx,ws,d.container.id,d.container.revision)
  return { ...result, id:d.container.id }
}
function row(jobId: string) { return ctx.db.select().from(jobs).where(and(eq(jobs.workspaceId,ws),eq(jobs.id,jobId))).get()! }
function due() { now=new Date('2026-10-09T16:00:00.000Z'); return leaseNext(ctx.db,now,60000)! }
function checkpoint(jobId: string, value: unknown) { ctx.db.update(jobs).set({resultJson:JSON.stringify(value)}).where(eq(jobs.id,jobId)).run() }

it('persists empty drafts, deduplicates create, rejects changed request and incomplete scheduling',()=>{
  const request=randomUUID(), value={name:'Rascunho'}
  const a=createContainer(ctx,ws,request,value), b=createContainer(ctx,ws,request,value)
  expect(a).toEqual(b);expect(a.container.state).toBe('draft');expect(a.total).toBe(0)
  expect(()=>createContainer(ctx,ws,request,{name:'Diferente'})).toThrow(/outra configuração/)
  expect(()=>scheduleContainer(ctx,ws,a.container.id,1)).toThrow(/Informe/)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
})
it('updates/reorders/removes draft atomically and rejects stale revisions, duplicate media and cross-workspace assets',()=>{
  const second=addAsset('second'), d=draft([asset,second])
  const input={name:'Reordenado',items:[{assetId:second},{assetId:asset,captionOverride:''}]}
  const updated=updateContainerDraft(ctx,ws,d.container.id,1,input)
  expect(updated.items.map(i=>i.assetId)).toEqual([second,asset]);expect(updated.container.revision).toBe(2)
  expect(()=>updateContainerDraft(ctx,ws,d.container.id,1,input)).toThrow(/mudou/)
  expect(()=>updateContainerDraft(ctx,ws,d.container.id,2,{name:'Erro',items:[{assetId:asset},{assetId:asset}]})).toThrow(/repostagem/)
  expect(()=>updateContainerDraft(ctx,ws,d.container.id,2,{name:'Erro',items:[{assetId:'missing'}]})).toThrow(/Vídeo/)
  expect(readContainer(ctx,ws,d.container.id)).toEqual(updated)
  const removed=updateContainerDraft(ctx,ws,d.container.id,2,{name:'Menor',items:[{assetId:asset}]})
  expect(removed.total).toBe(1)
})
it('plans twelve independent videos at 13:00 local, 15 min apart, last 15:45 and duration 165 min',()=>{
  const ids=Array.from({length:12},(_,i)=>addAsset(`video-${i}`))
  const start=zonedToUtc('2026-10-09','13:00','America/Sao_Paulo').toISOString()
  const d=draft(ids,{plannedStartAt:start}), result=scheduleContainer(ctx,ws,d.container.id,1)
  expect(result.jobs).toHaveLength(12);expect(new Set(result.jobs.map(j=>j.id)).size).toBe(12)
  expect(result.detail.container).toMatchObject({state:'scheduled',plannedStartAt:start,plannedEndAt:'2026-10-09T18:45:00.000Z',plannedDurationMin:165,quotaDemand:12,quotaTotal:null})
  expect(result.detail.items.map(i=>i.position)).toEqual(Array.from({length:12},(_,i)=>i))
  expect(result.jobs.map(j=>j.runAt)).toEqual(ids.map((_,i)=>new Date(Date.parse(start)+i*15*60000).toISOString()))
})
it('rolls back ALL jobs and snapshots when a later item has an invalid recipe',()=>{
  const second=addAsset('second'), d=draft([asset,second],{items:[{assetId:asset},{assetId:second,recipeVersionId:'invalid'}]})
  expect(()=>scheduleContainer(ctx,ws,d.container.id,1)).toThrow(/Versão editada/)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
  expect(readContainer(ctx,ws,d.container.id)).toEqual(d)
})
it('lost schedule response returns the same jobs even after the planned time, with immutable snapshots',()=>{
  const d=draft([asset],{captionBase:'Base',items:[{assetId:asset,captionOverride:null}]}), first=scheduleContainer(ctx,ws,d.container.id,1)
  now=new Date('2026-10-10T00:00:00Z')
  expect(scheduleContainer(ctx,ws,d.container.id,1).jobs).toEqual(first.jobs)
  expect(()=>updateContainerDraft(ctx,ws,d.container.id,2,{name:'Changed'})).toThrow(/rascunhos/)
  expect(first.detail.items[0].effectiveCaption).toBe('Base')
  expect(()=>scheduleContainer(ctx,ws,d.container.id,99)).toThrow(/já foi/)
})
it('distinguishes inherited caption from explicitly empty override',()=>{
  const second=addAsset('second'), d=draft([asset,second],{captionBase:'Base',items:[{assetId:asset,captionOverride:null},{assetId:second,captionOverride:''}]})
  expect(scheduleContainer(ctx,ws,d.container.id,1).detail.items.map(i=>i.effectiveCaption)).toEqual(['Base',''])
})
it('equivalent intention in another Container is rejected without adopting or duplicating a job',()=>{
  const first=planned(), second=draft()
  expect(()=>scheduleContainer(ctx,ws,second.container.id,1)).toThrow(/outro Container/)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(1)
  expect(readContainer(ctx,ws,second.container.id).container.state).toBe('draft')
  expect(row(first.jobs[0].id).resultJson).toBeNull()
})
it('failure of one item does not gate the next and retry reopens completed-with-failures',()=>{
  const p=planned([asset,addAsset('second')]), one=due()
  fail(ctx.db,one,now,{code:'invalid_media',message:'synthetic failure',permanent:true})
  expect(readContainer(ctx,ws,p.id).container).toMatchObject({state:'in_progress',counts:{failed:1,pending:1}})
  now=new Date('2026-10-09T16:15:00Z');const two=leaseNext(ctx.db,now,60000)!
  expect(two.id).toBe(p.jobs[1].id);complete(ctx.db,two,now)
  expect(readContainer(ctx,ws,p.id).container.state).toBe('completed_with_failures')
  retryNow(ctx.db,ws,one.id,now)
  expect(readContainer(ctx,ws,p.id).container.state).toBe('in_progress')
})
it('quota account A waits without burning retries, B continues and planned timestamps survive',async()=>{
  await connectInstagram(ctx,vault,ws,'synthetic-b',vi.fn().mockResolvedValue({id:'222',user_id:'222',username:'b'}))
  const b=ctx.db.select().from(destinationAccounts).where(eq(destinationAccounts.providerId,'222')).get()!
  const p=planned(), d=draft([asset],{destinationAccountId:'222',accountRevision:b.revision})
  const bJobs=scheduleContainer(ctx,ws,d.container.id,1).jobs
  const a=due();checkpoint(a.id,{containerId:'987',publishing:false})
  expect(deferPublicationAccount(ctx,a)).not.toBeNull()
  expect(row(a.id)).toMatchObject({state:'queued',attempts:0})
  expect(readContainer(ctx,ws,p.id).container).toMatchObject({counts:{waitingQuota:1},plannedStartAt:'2026-10-09T16:00:00.000Z'})
  expect(leaseNext(ctx.db,now,60000)!.id).toBe(bJobs[0].id)
})
it('pauses fresh jobs, leaves legacy jobs eligible and resumes without rewriting the plan',()=>{
  const p=planned();setContainerControl(ctx,ws,p.id,2,'paused');now=new Date('2026-10-09T16:00:00Z')
  expect(leaseNext(ctx.db,now,60000)).toBeNull()
  const legacy=enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:'222',batchId:'legacy'},label:'Legacy',runAt:now},now)
  expect(leaseNext(ctx.db,now,60000)!.id).toBe(legacy.id)
  setContainerControl(ctx,ws,p.id,3,'active')
  expect(leaseNext(ctx.db,now,60000)!.id).toBe(p.jobs[0].id)
  expect(row(p.jobs[0].id).runAt).toBe(p.jobs[0].runAt)
})
it('pause during preparation blocks the first POST, releases temporary media and preserves lease/checkpoint',async()=>{
  const p=planned(), job=due()
  deps.prepare=vi.fn().mockImplementation(async path=>{setContainerControl(ctx,ws,p.id,2,'paused');return {path,cleanup:vi.fn()}})
  const api=vi.fn()
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toBeInstanceOf(ContainerHeld)
  expect(api).not.toHaveBeenCalled()
  expect(holdContainerJob(ctx,job,'paused')).toBe(true)
  expect(row(job.id)).toMatchObject({state:'queued',attempts:0,leaseVersion:job.leaseVersion})
  expect(JSON.parse(row(job.id).resultJson!)).not.toMatchObject({creating:true})
})
it('paused FINISHED container is polled but not published and resumes the same remote container',async()=>{
  const p=planned(), job=due();checkpoint(job.id,{containerId:'987',creating:true})
  setContainerControl(ctx,ws,p.id,2,'paused')
  const api=vi.fn().mockResolvedValue({status_code:'FINISHED'})
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toBeInstanceOf(ContainerHeld)
  expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][2]).toBeUndefined()
  holdContainerJob(ctx,job,'paused');now=new Date(now.getTime()+60000)
  const polled=leaseNext(ctx.db,now,60000)!
  expect(polled.id).toBe(job.id)
  setContainerControl(ctx,ws,p.id,3,'active')
  api.mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'456'})
  const result=await publishInstagram(ctx,polled,api,deps);complete(ctx.db,polled,now,result)
  expect(api.mock.calls.filter(c=>Boolean(c[2]))).toHaveLength(1)
  expect(deps.prepare).not.toHaveBeenCalled()
  expect(readContainer(ctx,ws,p.id).container.state).toBe('completed')
})
it.each(['pause','cancel'] as const)('%s during ambiguous publish permits status reconciliation without a second POST',async action=>{
  const p=planned(), job=due();checkpoint(job.id,{containerId:'987',publishing:true})
  deferJob(ctx.db,job,now,1)
  if(action==='pause')setContainerControl(ctx,ws,p.id,2,'paused');else await cancelContainer(ctx,ws,p.id,2)
  now=new Date(now.getTime()+2);const reconcile=leaseNext(ctx.db,now,60000)!
  const api=vi.fn().mockResolvedValue({status_code:'PUBLISHED'})
  const result=await publishInstagram(ctx,reconcile,api,deps);complete(ctx.db,reconcile,now,result)
  expect(api).toHaveBeenCalledTimes(1);expect(api.mock.calls[0][2]).toBeUndefined()
  expect(readContainer(ctx,ws,p.id).container).toMatchObject({state:action==='cancel'?'cancelled':'completed',counts:{confirmed:1}})
})
it('cancel blocks fresh and prepared items but retains ambiguity for manual review',async()=>{
  const p=planned([asset,addAsset('second'),addAsset('third')])
  checkpoint(p.jobs[1].id,{containerId:'987',creating:true,publishing:false})
  checkpoint(p.jobs[2].id,{creating:true})
  const cancelled=await cancelContainer(ctx,ws,p.id,2)
  expect(cancelled.container.state).toBe('cancelled')
  expect(row(p.jobs[0].id).state).toBe('cancelled');expect(row(p.jobs[1].id).state).toBe('cancelled')
  expect(row(p.jobs[2].id).state).toBe('queued')
  expect(JSON.parse(row(p.jobs[1].id).resultJson!)).toMatchObject({containerId:'987'})
  now=new Date('2026-10-09T16:30:00Z');const ambiguous=leaseNext(ctx.db,now,60000)!
  const api=vi.fn();await expect(publishInstagram(ctx,ambiguous,api,deps)).rejects.toThrow(/sem confirmação/)
  expect(api).not.toHaveBeenCalled();fail(ctx.db,ambiguous,now,{code:'invalid_input',message:'Manual review',permanent:true})
  expect(()=>retryNow(ctx.db,ws,ambiguous.id,now)).toThrow(/cancelado/)
})
it('cancel during a successful in-flight publish records late confirmation',async()=>{
  const p=planned(), job=due()
  const api=vi.fn().mockResolvedValueOnce({id:'987'}).mockResolvedValueOnce({status_code:'FINISHED'})
    .mockImplementationOnce(async()=>{await cancelContainer(ctx,ws,p.id,2);return {id:'456'}})
  const result=await publishInstagram(ctx,job,api,deps);expect(complete(ctx.db,job,now,result)).toBe(true)
  expect(readContainer(ctx,ws,p.id).container).toMatchObject({state:'cancelled',counts:{confirmed:1}})
  expect(ctx.db.select().from(publicationHistory).all()).toHaveLength(1)
})
it('Container cancellation rejects rescheduling failed items; retry while paused remains gated',async()=>{
  const p=planned(), job=due();fail(ctx.db,job,now,{code:'invalid_media',message:'Failure',permanent:true})
  // A Container with only terminal items cannot be paused; reopen the item first.
  retryNow(ctx.db,ws,job.id,now);setContainerControl(ctx,ws,p.id,2,'paused')
  expect(leaseNext(ctx.db,now,60000)).toBeNull()
  await cancelContainer(ctx,ws,p.id,3)
  ctx.db.update(jobs).set({state:'failed'}).where(eq(jobs.id,job.id)).run()
  expect(()=>reschedule(ctx.db,ws,job.id,'2026-10-09T17:00:00Z',row(job.id).updatedAt,now)).toThrow(/cancelado/)
})
it('reopens a paused file-backed database with the same checkpoints and rejects an obsolete lease',async()=>{
  const handle=openDb(join(root,'restart.sqlite'),MIGRATIONS_DIR);ctx.db=handle.db
  ws=createWorkspace(ctx.db,{name:'Restart',timeZone:'UTC'}).id
  accountRevision=(await connectInstagram(ctx,vault,ws,'synthetic-a',vi.fn().mockResolvedValue({id:'111',user_id:'111',username:'a'}))).revision
  asset=addAsset('restart-media');const p=planned(), old=due()
  checkpoint(old.id,{containerId:'987',publishing:true});setContainerControl(ctx,ws,p.id,2,'paused')
  handle.close();const reopened=openDb(join(root,'restart.sqlite'),MIGRATIONS_DIR);ctx.db=reopened.db
  try {
    now=new Date(now.getTime()+61000);expect(recoverExpired(ctx.db,now)).toBe(1)
    const fresh=leaseNext(ctx.db,now,60000)!
    expect(fresh.id).toBe(old.id);expect(fresh.leaseVersion).toBeGreaterThan(old.leaseVersion)
    expect(complete(ctx.db,old,now)).toBe(false)
    expect(ctx.db.select({id:jobs.id}).from(jobs).where(ownedJob(ctx.db,old,now)).get()).toBeUndefined()
    expect(JSON.parse(row(old.id).resultJson!)).toEqual({containerId:'987',publishing:true})
    expect(readContainer(ctx,ws,p.id).container.state).toBe('paused')
  }finally{reopened.close()}
})
it('isolates workspace reads/controls and composite FK references',()=>{
  const d=draft(), other=createWorkspace(ctx.db,{name:'Other',timeZone:'UTC'}).id
  expect(()=>readContainer(ctx,other,d.container.id)).toThrow(/não encontrado/)
  expect(()=>setContainerControl(ctx,other,d.container.id,1,'paused')).toThrow(/não encontrado/)
  expect(()=>createContainer(ctx,other,randomUUID(),{name:'Invalid',items:[{assetId:asset}]})).toThrow(/Vídeo/)
  expect(()=>ctx.db.insert(items).values({id:randomUUID(),workspaceId:other,containerId:d.container.id,position:0,assetId:asset,sourceSnapshotJson:'{}',createdAt:now.toISOString(),updatedAt:now.toISOString()}).run()).toThrow(/FOREIGN KEY/)
  expect(listContainers(ctx,other,{page:1,pageSize:50}).total).toBe(0)
})
it('protects draft media; after cancellation detaches asset FK and preserves source snapshot',async()=>{
  const d=draft();expect(()=>deleteAssetRow(ctx.db,ws,asset)).toThrow(/Container/)
  await cancelContainer(ctx,ws,d.container.id,1);deleteAssetRow(ctx.db,ws,asset)
  expect(readContainer(ctx,ws,d.container.id).items[0]).toMatchObject({assetId:null,source:{sha256:`sha-${asset}`,name:`${asset}.mp4`}})
})
it('filters state BEFORE pagination and never infers confirmation from done alone',()=>{
  draft();draft();const p=planned(), job=due();complete(ctx.db,job,now)
  const filtered=listContainers(ctx,ws,{page:1,pageSize:1,state:'completed_with_failures'})
  expect(filtered.total).toBe(1);expect(filtered.items[0].id).toBe(p.id)
  expect(filtered.items[0].counts.confirmed).toBe(0)
})
it('multi-account batch adapter is atomic and preserves batchId, order and replay identity',async()=>{
  const second=addAsset('second')
  const b=await connectInstagram(ctx,vault,ws,'synthetic-b',vi.fn().mockResolvedValue({id:'222',user_id:'222',username:'b'}))
  const batch=randomUUID(), values=[{media:asset,provider:'instagram' as const,destinationAccount:'111',accountRevision,publishAt:'2026-10-09T16:00:00Z',caption:'A',shareToFeed:true,allowRepost:false},
    {media:second,provider:'instagram' as const,destinationAccount:'222',accountRevision:b.revision,publishAt:'2026-10-09T17:00:00Z',caption:'B',shareToFeed:true,allowRepost:false},
    {media:addAsset('third'),provider:'instagram' as const,destinationAccount:'111',accountRevision,publishAt:'2026-10-09T15:30:00Z',caption:'C',shareToFeed:true,allowRepost:false}]
  expect(()=>schedulePublicationBatch(ctx,ws,batch,[values[0],{...values[1],versionId:'invalid'}])).toThrow(/Versão/)
  expect(ctx.db.select().from(containers).all()).toHaveLength(0);expect(ctx.db.select().from(jobs).all()).toHaveLength(0)
  const first=schedulePublicationBatch(ctx,ws,batch,values), replay=schedulePublicationBatch(ctx,ws,batch,values)
  expect(replay).toEqual(first);expect(ctx.db.select().from(containers).all()).toHaveLength(2)
  expect(listContainers(ctx,ws,{page:1,pageSize:50,destinationAccountId:'111'}).items[0]).toMatchObject({plannedStartAt:'2026-10-09T15:30:00.000Z',plannedEndAt:'2026-10-09T16:00:00.000Z',plannedDurationMin:30})
  for (const j of first)expect(JSON.parse(row(j.id).payloadJson)).toMatchObject({batchId:batch})
  expect(()=>schedulePublicationBatch(ctx,ws,batch,[{...values[0],publishAt:'2026-10-09T18:00:00Z'},values[1]])).toThrow(/outra configuração/)
})
it('compose adapter double-click returns the same Container and jobs',()=>{
  const input={assetIds:[asset],accountId:'111',accountRevision,firstAt:'2026-10-09T16:00:00Z',intervalMin:15,captions:{[asset]:'Caption'},cleanupAfterPublish:false}
  const first=scheduleComposition(ctx,ws,input), second=scheduleComposition(ctx,ws,input)
  expect(first).toEqual(second);expect(ctx.db.select().from(containers).all()).toHaveLength(1)
  expect(()=>scheduleComposition(ctx,ws,{...input,captions:{[asset]:'Other'}})).toThrow(/outro Container/)
})
it('legacy technical batch is not adopted automatically even when matching a new adapter batch',()=>{
  const batch=randomUUID()
  enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{batchId:batch,accountId:'111',localAssetId:asset,postId:null,caption:'',shareToFeed:true},label:'Legacy',runAt:new Date('2026-10-09T16:00:00Z'),idempotencyKey:`publish:${ws}:111:${asset}:2026-10-09T16:00:00.000Z`},now)
  expect(()=>schedulePublicationBatch(ctx,ws,batch,[{media:asset,provider:'instagram',destinationAccount:'111',accountRevision,publishAt:'2026-10-09T16:00:00Z',caption:'',shareToFeed:true,allowRepost:false}])).toThrow(/lote legado/)
  expect(ctx.db.select().from(containers).all()).toHaveLength(0)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(1)
})
it('real dispatcher validates all eight channels and exposes DTOs without credentials or raw payloads',async()=>{
  const changed=vi.fn(), handlers=buildHandlers({ctx,workerAlive:()=>true,version:'test',onJobsChanged:changed,shell:{openPath:async()=>''},dialogs:{pickVideos:async()=>[],pickImage:async()=>null,pickMetricsFile:async()=>null}})
  const dispatch=createDispatcher(handlers)
  const created=await dispatch('containers.create',{workspaceId:ws,requestId:randomUUID(),draft:{name:'IPC'}})
  expect(created.ok).toBe(true);if(!created.ok)throw Error('create')
  const d=created.data as ReturnType<typeof draft>
  const update=await dispatch('containers.updateDraft',{workspaceId:ws,containerId:d.container.id,expectedRevision:1,draft:{name:'IPC',provider:'instagram',destinationAccountId:'111',accountRevision,plannedStartAt:'2026-10-09T16:00:00Z',items:[{assetId:asset}]}})
  expect(update.ok).toBe(true)
  const mutation={workspaceId:ws,containerId:d.container.id,expectedRevision:2}
  expect((await dispatch('containers.schedule',mutation)).ok).toBe(true)
  expect((await dispatch('containers.pause',{...mutation,expectedRevision:3})).ok).toBe(true)
  expect((await dispatch('containers.resume',{...mutation,expectedRevision:4})).ok).toBe(true)
  expect((await dispatch('containers.cancel',{...mutation,expectedRevision:5})).ok).toBe(true)
  const got=await dispatch('containers.get',{workspaceId:ws,containerId:d.container.id})
  expect(got.ok).toBe(true);expect(JSON.stringify(got)).not.toContain('synthetic-a');expect(JSON.stringify(got)).not.toContain('payloadJson')
  expect((await dispatch('containers.query',{workspaceId:ws,state:'cancelled'})).ok).toBe(true)
  expect((await dispatch('containers.get',{workspaceId:ws,containerId:d.container.id,pageSize:1001})).ok).toBe(false)
  expect((await dispatch('containers.create',{workspaceId:ws,requestId:randomUUID(),draft:{name:'Invalid',token:'secret'}})).ok).toBe(false)
  expect(changed).toHaveBeenCalledTimes(6)
})
it('aggregates 1,000 scheduled items independently of a page of 50, with indexed claim',()=>{
  const ids=Array.from({length:1000},(_,i)=>addAsset(`large-${i}`)), start=performance.now()
  const d=draft(ids,{items:ids.map(assetId=>({assetId,allowRepost:true}))}), p=scheduleContainer(ctx,ws,d.container.id,1)
  const scheduledMs=performance.now()-start, queryStart=performance.now(), page=readContainer(ctx,ws,d.container.id,2,50)
  expect(page.total).toBe(1000);expect(page.items).toHaveLength(50);expect(page.container.counts.pending).toBe(1000)
  expect(page.items[0].position).toBe(50)
  const queryMs=performance.now()-queryStart;now=new Date('2026-10-09T16:00:00Z');const claimStart=performance.now()
  expect(leaseNext(ctx.db,now,60000)!.id).toBe(p.jobs[0].id)
  console.info(JSON.stringify({containerBenchmark:{items:1000,scheduledMs,queryMs,claimMs:performance.now()-claimStart,provider:'mock; no network'}}))
  if(process.env.LEGACY_CONTAINER_BENCHMARK_FILE)writeFileSync(process.env.LEGACY_CONTAINER_BENCHMARK_FILE,JSON.stringify({items:1000,scheduledMs,queryMs,claimMs:performance.now()-claimStart,provider:'mock; no network',runtime:'Electron',measuredAt:new Date().toISOString()},null,2))
  const indexes=ctx.db.all<{name:string}>(sql`select name from sqlite_master where type='index' and name like 'publication_container_items_%'`)
  expect(indexes.map(i=>i.name)).toContain('publication_container_items_job')
})

it('projects all seven states with cancellation/completion precedence and validates draft limits',()=>{
  const base:ContainerCounts={total:1,confirmed:0,pending:1,running:0,failed:0,cancelled:0,terminal:0,started:0,remoteOpen:0,waitingQuota:0}
  expect(projectContainerState(false,'active',base)).toBe('draft')
  expect(projectContainerState(true,'active',base)).toBe('scheduled')
  expect(projectContainerState(true,'active',{...base,started:1})).toBe('in_progress')
  expect(projectContainerState(true,'paused',base)).toBe('paused')
  expect(projectContainerState(true,'paused',{...base,confirmed:1,terminal:1})).toBe('completed')
  expect(projectContainerState(true,'paused',{...base,failed:1,terminal:1})).toBe('completed_with_failures')
  expect(projectContainerState(false,'cancelled',base)).toBe('cancelled')
  expect(containerDraftInput.safeParse({name:'Invalid',provider:'instagram'}).success).toBe(false)
  expect(containerDraftInput.safeParse({name:'Invalid',timeZone:'invalid-zone'}).success).toBe(false)
  expect(containerDraftInput.safeParse({name:'Invalid',intervalMin:14}).success).toBe(false)
})

it('worker handles ContainerHeld without consuming attempts or generating failure notifications',async()=>{
  const p=planned();now=new Date('2026-10-09T16:00:00Z')
  const spy=vi.spyOn(instagram,'publishInstagram').mockImplementationOnce(async()=>{
    setContainerControl(ctx,ws,p.id,2,'paused');throw new ContainerHeld('paused')
  })
  const events: string[]=[]
  try {
    expect(await processNext(ctx,e=>events.push(e.state))).toBe(true)
    expect(events).toEqual(['running','retry'])
    expect(row(p.jobs[0].id)).toMatchObject({state:'queued',attempts:0,lastError:null})
    expect(ctx.db.get<{n:number}>(sql`select count(*) n from notifications`)!.n).toBe(0)
    expect(await processNext(ctx,()=>{})).toBe(false)
  }finally{spy.mockRestore()}
})
it('cancel followed by worker crash settles an expired lease with no remote checkpoint',async()=>{
  const p=planned(), job=due();await cancelContainer(ctx,ws,p.id,2)
  now=new Date(now.getTime()+61000);recoverExpired(ctx.db,now)
  expect(leaseNext(ctx.db,now,60000)).toBeNull()
  expect(row(job.id).state).toBe('cancelled')
  expect(readContainer(ctx,ws,p.id).container.counts.pending).toBe(0)
})
it('migration 0008 preserves legacy jobs byte for byte and creates no automatic Containers',()=>{
  const folder=join(root,'old-migrations');mkdirSync(folder);mkdirSync(join(folder,'meta'))
  const journal=JSON.parse(readFileSync(join(MIGRATIONS_DIR,'meta','_journal.json'),'utf8'))
  journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<8)
  writeFileSync(join(folder,'meta','_journal.json'),JSON.stringify(journal))
  for(const entry of journal.entries)copyFileSync(join(MIGRATIONS_DIR,`${entry.tag}.sql`),join(folder,`${entry.tag}.sql`))
  const file=join(root,'migration.sqlite'), old=openDb(file,folder)
  let previous: unknown
  try {
    const workspace=createWorkspace(old.db,{name:'Legacy',timeZone:'UTC'}).id
    const job=enqueue(old.db,{workspaceId:workspace,type:'publish_instagram',payload:{batchId:'heterogeneous-legacy',accountId:'111'},label:'Legacy'},now)
    old.db.update(jobs).set({resultJson:JSON.stringify({containerId:'123',publishing:true}),state:'failed'}).where(eq(jobs.id,job.id)).run()
    previous=old.db.select().from(jobs).all()
  }finally{old.close()}
  const migrated=openDb(file,MIGRATIONS_DIR)
  try {
    expect(migrated.db.select().from(jobs).all()).toEqual(previous)
    expect(migrated.db.select().from(containers).all()).toHaveLength(0)
    expect(migrated.db.all(sql`pragma foreign_key_check`)).toHaveLength(0)
  }finally{migrated.close()}
})
it('schedules an older compatibility account without reconnecting, preserving identity and encrypted token',()=>{
  const encrypted=getSetting(ctx.db,ws,'secret.instagramToken')
  ctx.db.delete(destinationAccounts).where(eq(destinationAccounts.workspaceId,ws)).run()
  ctx.db.delete(settings).where(and(eq(settings.workspaceId,ws),eq(settings.key,'secret.instagramToken:111'))).run()
  const input={assetIds:[asset],accountId:'111',accountRevision,firstAt:'2026-10-09T16:00:00Z',intervalMin:15,captions:{},cleanupAfterPublish:false}
  const scheduled=scheduleComposition(ctx,ws,input)
  expect(scheduled).toHaveLength(1)
  expect(getSetting(ctx.db,ws,'secret.instagramToken:111')).toBe(encrypted)
  expect(ctx.db.select().from(destinationAccounts).get()).toMatchObject({providerId:'111',revision:accountRevision})
  expect(scheduleComposition(ctx,ws,input).map(j=>j.id)).toEqual(scheduled.map(j=>j.id))
})

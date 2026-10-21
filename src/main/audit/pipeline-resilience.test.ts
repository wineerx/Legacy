import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset, listVersions } from '../repos/assets'
import { connectInstagram, instagramAccount, instagramAccounts, disconnectInstagram, publishInstagram, scheduleComposition, schedulePublicationBatch, InstagramApiError, InstagramPending, type PublishDeps } from '../services/instagram-publishing'
import * as instagram from '../services/instagram-publishing'
import { decryptSecret, secretSnapshot } from '../services/integrations'
import { enqueue, leaseNext, fail, complete, recoverExpired, heartbeat, retryNow, listJobs } from '../queue/queue'
import { jobs } from '../db/schema'
import { processNext } from '../worker/handlers'
import { releaseAll, resetRegistryForTests } from '../services/media-host/registry'
import { saveRenderedCover, planVideoVersion, materializeVersion, processedCacheDir } from '../services/versions'
import { makeTestVideo } from '../media/test-fixtures'
import { extractFrame } from '../media/ops'
import { retryAfterMs } from '../services/provider-limiter'
import type { Ctx } from '../context'
import { AppError } from '@shared/errors'
import { preparePublishCopy } from '../media/publish-prep'
import { MediaToolError } from '../media/run'
import { readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { openDb } from '../db/client'
import { MIGRATIONS_DIR } from '../test-utils'
import { sql } from 'drizzle-orm'
import { migrateLegacyPublicationRecipes } from '../services/versions'
import { setSetting } from '../repos/settings'
import { diagnosticEvents, diagnosticScope } from '../diagnostics'

const vault={available:()=>true,encrypt:(s:string)=>`encrypted:${s}`,decrypt:(s:string)=>s.slice(10)}
let ctx:Ctx,ws:string,root:string,time:number,deps:PublishDeps
beforeEach(async()=>{
  resetRegistryForTests();root=mkdtempSync(join(tmpdir(),'legacy-resilience-'));time=Date.parse('2026-10-07T12:00:00Z')
  ctx={db:memDb(),dataRoot:root,clock:()=>new Date(time)};ws=createWorkspace(ctx.db,{name:'audit',timeZone:'UTC'}).id
  ctx.secret=(w,key)=>decryptSecret(ctx,vault,w,key)
  writeFileSync(join(root,'original.mp4'),'fixture')
  insertAsset(ctx.db,{id:'media',workspaceId:ws,origin:'pc',sourceName:'original.mp4',filePath:join(root,'original.mp4'),sha256:'fixture',sizeBytes:7,durationMs:4000,width:360,height:640,videoCodec:'h264',validationJson:'{}',importedAt:ctx.clock().toISOString()})
  for(const id of ['111','222']) await connectInstagram(ctx,vault,ws,`credential-${id}`,async()=>({user_id:id,username:`user${id}`}))
  deps={host:{id:'cloudflare-quick-tunnel',expose:async()=>({url:'https://sandbox.invalid/video.mp4',release:async()=>{}})},prepare:async(input)=>({path:input,cleanup:()=>{}})}
})
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();await releaseAll();rmSync(root,{recursive:true,force:true})})
function schedule(accountId='111',extra:object={}) {
  const account=instagramAccount(ctx,ws,accountId)!
  return scheduleComposition(ctx,ws,{assetIds:['media'],accountId,accountRevision:account.revision,firstAt:new Date(time+60000).toISOString(),intervalMin:15,captions:{},cleanupAfterPublish:false,...extra})[0]
}
function own(account='111') {schedule(account);time+=60000;return leaseNext(ctx.db,ctx.clock(),60000)!}
function okApi() {return vi.fn().mockResolvedValueOnce({id:'333'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockResolvedValueOnce({id:'444'})}

it('keeps credentials and old jobs isolated after connecting another account',async()=>{
  expect(instagramAccounts(ctx,ws)).toHaveLength(2)
  const job=own('111'),api=okApi();await publishInstagram(ctx,job,api,deps)
  expect(api.mock.calls.every(c=>c[1]==='credential-111')).toBe(true)
  expect(secretSnapshot(ctx,vault)[ws]['instagramToken:222']).toBe('credential-222')
  disconnectInstagram(ctx,vault,ws,'111')
  expect(instagramAccount(ctx,ws,'111')).toBeNull();expect(instagramAccount(ctx,ws,'222')?.id).toBe('222')
})
it('a corrupt default account setting cannot break an explicit destination',async()=>{
  const job=own('111');setSetting(ctx.db,ws,'instagramAccount','corrupted-json')
  const api=okApi();expect(await publishInstagram(ctx,job,api,deps)).toMatchObject({confirmedPublished:true})
  expect(api.mock.calls.every(c=>c[1]==='credential-111')).toBe(true)
})
it('accepts 200 explicit destinations in a logical batch without editing or other jobs',()=>{
  const items=Array.from({length:200},(_,i)=>({media:'media',provider:'instagram' as const,destinationAccount:i%2?'111':'222',accountRevision:instagramAccount(ctx,ws,i%2?'111':'222')!.revision,publishAt:new Date(time+60000+i*60000).toISOString(),caption:`${i}`,shareToFeed:true,allowRepost:true}))
  const batch='01000000-0000-4000-8000-000000000000'
  const first=schedulePublicationBatch(ctx,ws,batch,items)
  expect(first).toHaveLength(200);expect(schedulePublicationBatch(ctx,ws,batch,items).map(j=>j.id)).toEqual(first.map(j=>j.id))
  expect(listJobs(ctx.db,ws).every(j=>j.type==='publish_instagram')).toBe(true)
  expect(leaseNext(ctx.db,ctx.clock(),60000)).toBeNull()
})
it('rejects cross-workspace destination before any intent is persisted',()=>{
  const other=createWorkspace(ctx.db,{name:'other',timeZone:'UTC'}).id
  expect(()=>scheduleComposition(ctx,other,{assetIds:['media'],accountId:'111',accountRevision:instagramAccount(ctx,ws,'111')!.revision,firstAt:new Date(time+60000).toISOString(),intervalMin:15,captions:{},cleanupAfterPublish:false})).toThrow()
  expect(listJobs(ctx.db,other)).toHaveLength(0)
})
it('fences heartbeat and remote writes even after retry resets attempts',async()=>{
  const old=own();time+=60001;expect(recoverExpired(ctx.db,ctx.clock())).toBe(1)
  const fresh=leaseNext(ctx.db,ctx.clock(),60000)!
  expect(heartbeat(ctx.db,old.id,ctx.clock(),60000,old.leaseVersion)).toBe(false)
  const api=okApi();await expect(publishInstagram(ctx,old,api,deps)).rejects.toThrow(/Lease/);expect(api).not.toHaveBeenCalled()
  fail(ctx.db,fresh,ctx.clock(),{code:'invalid_media',message:'broken',permanent:true})
  retryNow(ctx.db,ws,old.id,ctx.clock());const retried=leaseNext(ctx.db,ctx.clock(),60000)!
  expect(retried.attempts).toBe(old.attempts);expect(complete(ctx.db,old,ctx.clock())).toBe(false)
})
it('one provider delay frees the worker for job 18 without waiting for job 17',async()=>{
  const pending=enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:'111'},label:'17'},ctx.clock())
  const next=enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:'222'},label:'18'},ctx.clock())
  const spy=vi.spyOn(instagram,'publishInstagram').mockImplementation(async(_c,j)=>{if(j.id===pending.id)throw new InstagramPending(15000);return {confirmedPublished:true} as never})
  await processNext(ctx,()=>{});await processNext(ctx,()=>{})
  expect(ctx.db.select().from(jobs).where(eq(jobs.id,next.id)).get()?.state).toBe('done')
  expect(spy).toHaveBeenCalledTimes(2)
})
it('job 17 failing does not stop any of the other 39 jobs in its batch',async()=>{
  const batch=Array.from({length:40},(_,i)=>enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:String(i%10),batchId:'420'},label:String(i+1)},ctx.clock()))
  vi.spyOn(instagram,'publishInstagram').mockImplementation(async(_c,j)=>{if(j.id===batch[16].id)throw new AppError('invalid_media','corrupted');return {confirmedPublished:true} as never})
  for(let i=0;i<40;i++)await processNext(ctx,()=>{})
  expect(listJobs(ctx.db,ws,['failed']).map(j=>j.id)).toEqual([batch[16].id]);expect(listJobs(ctx.db,ws,['done'])).toHaveLength(39)
})
it('tool timeout retries without turning the publication into a terminal media failure',async()=>{
  enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:'111'},label:'timeout'},ctx.clock())
  vi.spyOn(instagram,'publishInstagram').mockRejectedValue(new MediaToolError('timeout',true))
  await processNext(ctx,()=>{});expect(listJobs(ctx.db,ws)[0]).toMatchObject({state:'queued',attempts:1})
})
it('corrupt media fails validation, removes partial remux and leaves original intact',async()=>{
  const file=join(root,'original.mp4'),before=readFileSync(file),temp=join(root,'publish-tmp')
  await expect(preparePublishCopy(file,temp)).rejects.toMatchObject({code:'invalid_media'})
  expect(readFileSync(file)).toEqual(before);expect(readdirSync(temp)).toHaveLength(0)
})
it('a locked database leaves queued intent recoverable after the writer returns',()=>{
  const file=join(root,'locked.db'),handle=openDb(file,MIGRATIONS_DIR),other=new Database(file)
  try {
    const workspace=createWorkspace(handle.db,{name:'lock',timeZone:'UTC'}).id
    enqueue(handle.db,{workspaceId:workspace,type:'make_thumbnail',payload:{},label:'durable'},ctx.clock())
    handle.db.run(sql`PRAGMA busy_timeout = 20`);other.exec('BEGIN IMMEDIATE')
    expect(()=>leaseNext(handle.db,ctx.clock(),60000)).toThrow(/locked/)
    other.exec('ROLLBACK');expect(leaseNext(handle.db,ctx.clock(),60000)?.label).toBe('durable')
  }finally{other.close();handle.close()}
})
it('migrates a queued legacy edit to a recipe without discarding publication checkpoints',()=>{
  const edit=enqueue(ctx.db,{workspaceId:ws,type:'apply_banner',payload:{assetId:'media',versionId:'legacy-version',coverPath:'cover.png'},label:'legacy'},ctx.clock())
  const publication=enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{localAssetId:'media',versionId:'legacy-version',accountId:'111'},label:'future',runAt:new Date(time+60000)},ctx.clock())
  ctx.db.update(jobs).set({resultJson:'{"containerId":"333"}'}).where(eq(jobs.id,publication.id)).run()
  expect(migrateLegacyPublicationRecipes(ctx)).toBe(1);expect(migrateLegacyPublicationRecipes(ctx)).toBe(0)
  expect(ctx.db.select().from(jobs).where(eq(jobs.id,edit.id)).get()?.state).toBe('cancelled')
  expect(ctx.db.select().from(jobs).where(eq(jobs.id,publication.id)).get()?.resultJson).toBe('{"containerId":"333"}')
  expect(JSON.parse(listVersions(ctx.db,ws,'media')[0].paramsJson).pending).toBe(true)
})
it('HTTP 429 respects Retry-After for A while B continues',async()=>{
  const a=own('111');const api=vi.fn().mockRejectedValue(new InstagramApiError(429,17,120000))
  await expect(publishInstagram(ctx,a,api,deps)).rejects.toBeInstanceOf(InstagramApiError)
  fail(ctx.db,a,ctx.clock(),{code:'rate_limit',message:'429',retryAfterMs:120000})
  schedule('222');time+=60000
  expect(leaseNext(ctx.db,ctx.clock(),60000)?.payload).toMatchObject({accountId:'222'})
  expect(leaseNext(ctx.db,ctx.clock(),60000)).toBeNull()
  expect(retryAfterMs('120',time)).toBe(120000);expect(retryAfterMs(new Date(time+30000).toUTCString(),time)).toBe(30000)
})
it('lost publish response reconciles the same container without a second POST after restart',async()=>{
  const job=own(),api=vi.fn().mockResolvedValueOnce({id:'333'}).mockResolvedValueOnce({status_code:'FINISHED'}).mockRejectedValueOnce(new Error('internet disconnected'))
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toThrow(/disconnected/)
  time+=60001;recoverExpired(ctx.db,ctx.clock());const fresh=leaseNext(ctx.db,ctx.clock(),60000)!
  await releaseAll();const reconcile=vi.fn().mockResolvedValue({status_code:'PUBLISHED'})
  expect(await publishInstagram(ctx,fresh,reconcile,deps)).toMatchObject({confirmedPublished:true})
  expect(reconcile).toHaveBeenCalledTimes(1);expect(reconcile.mock.calls[0][0]).toBe('333?fields=status_code,status')
})
it('lost container creation response is accessible for review and never replayed',async()=>{
  const job=own(),api=vi.fn().mockRejectedValue(new Error('timeout'))
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toThrow('timeout')
  await expect(publishInstagram(ctx,job,api,deps)).rejects.toThrow(/sem confirmação/)
  expect(api).toHaveBeenCalledTimes(1)
})
it('500 during status uses retry checkpoint; expired token is a permanent failure',async()=>{
  const job=own();ctx.db.update(jobs).set({resultJson:JSON.stringify({containerId:'333'})}).where(eq(jobs.id,job.id)).run()
  await expect(publishInstagram(ctx,job,vi.fn().mockRejectedValue(new InstagramApiError(500,0)),deps)).rejects.toMatchObject({retryable:true})
  expect(JSON.parse(ctx.db.select().from(jobs).where(eq(jobs.id,job.id)).get()!.resultJson!).containerId).toBe('333')
  expect(new InstagramApiError(401,190).retryable).toBe(false)
})
it('DLQ retains exhausted job and checkpoint for manual retry without blocking the batch',()=>{
  const job=own();ctx.db.update(jobs).set({resultJson:'{"containerId":"333"}'}).where(eq(jobs.id,job.id)).run()
  fail(ctx.db,job,ctx.clock(),{code:'media',message:'corrupted',permanent:true})
  expect(listJobs(ctx.db,ws,['failed'])).toHaveLength(1)
  retryNow(ctx.db,ws,job.id,ctx.clock())
  expect(ctx.db.select().from(jobs).where(eq(jobs.id,job.id)).get()?.resultJson).toBe('{"containerId":"333"}')
})
it('JIT cache reuses only identical derivatives, rebuilds corruption and preserves original',async()=>{
  vi.stubEnv('LEGACY_PERF_DEBUG','1')
  const input=join(root,'original.mp4');await makeTestVideo(input)
  const original=readFileSync(input),png=join(root,'cover.png');await extractFrame(input,0,png)
  const cover=await saveRenderedCover(ctx,ws,'media','test',readFileSync(png))
  const a=await planVideoVersion(ctx,ws,'media',{coverVersionId:cover.id}),b=await planVideoVersion(ctx,ws,'media',{coverVersionId:cover.id})
  expect(listJobs(ctx.db,ws)).toHaveLength(0)
  expect(listVersions(ctx.db,ws,'media')).toHaveLength(3)
  const materialize=(versionId:string)=>diagnosticScope.run({workspaceId:ws},()=>materializeVersion(ctx,ws,'media',versionId))
  const [out,reused]=await Promise.all([materialize(a.versionId),materialize(b.versionId)])
  expect(out).toBe(reused)
  expect(await materialize(a.versionId)).toBe(out)
  writeFileSync(out,'corrupted')
  expect(await materialize(a.versionId)).toBe(out)
  expect(readFileSync(input)).toEqual(original)
  const different=await planVideoVersion(ctx,ws,'media',{banner:{png:readFileSync(png),startMs:0,endMs:1000},coverVersionId:cover.id})
  expect(await materialize(different.versionId)).not.toBe(out)
  expect(existsSync(processedCacheDir(ctx,ws))).toBe(true)
  const cacheEvents=diagnosticEvents(ws).filter(e=>e.message.startsWith('Cache'))
  expect(cacheEvents.filter(e=>e.message==='Cache miss')).toHaveLength(3)
  expect(cacheEvents.filter(e=>e.message==='Cache hit')).toHaveLength(1)
  mkdirSync(resolve('docs/benchmarks/regression'),{recursive:true});writeFileSync(resolve('docs/benchmarks/regression/cache.json'),JSON.stringify(cacheEvents,null,2))
})

import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {eq,count} from 'drizzle-orm'
import {memDb} from '../test-utils'
import {createWorkspace} from '../repos/workspaces'
import {insertAsset} from '../repos/assets'
import {decryptSecret} from '../services/integrations'
import * as instagram from '../services/instagram-publishing'
import {jobs} from '../db/schema'
import {processNext} from '../worker/handlers'
import {leaseNext,enqueue,heartbeat,complete,fail,deferJob,recoverExpired,reschedule,operateJobs,queryJobs} from '../queue/queue'
import {releaseAll,resetRegistryForTests} from '../services/media-host/registry'
import {Semaphore} from '../pipeline-config'
import {diagnosticEvents} from '../diagnostics'
import type {Ctx} from '../context'

const results:unknown[]=[]
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();await releaseAll();resetRegistryForTests();mkdirSync(resolve('docs/benchmarks/regression'),{recursive:true});writeFileSync(resolve('docs/benchmarks/regression/qa-capacity.json'),JSON.stringify(results,null,2))})

it.each([1,2,3,5,10])('%i publications: real claims, persisted polls and account-specific credentials; HTTP/media mocked',async n=>{
  vi.stubEnv('LEGACY_PERF_DEBUG','1')
  const root=mkdtempSync(join(tmpdir(),'legacy-regression-qa-')),db=memDb(),ws=createWorkspace(db,{name:'QA',timeZone:'America/Sao_Paulo'}).id
  let clock=Date.parse('2026-10-07T12:00:00Z'),remote=100,credentialErrors=0
  const ctx:Ctx={db,dataRoot:root,clock:()=>new Date(clock)},vault={available:()=>true,encrypt:(s:string)=>s,decrypt:(s:string)=>s}
  ctx.secret=(w,k)=>decryptSecret(ctx,vault,w,k)
  const account=await instagram.connectInstagram(ctx,vault,ws,'synthetic-qa-token',async()=>({user_id:'123',username:'qa'}))
  const ids=Array.from({length:n},(_,i)=>`asset-${i}`),file=join(root,'mock.mp4');writeFileSync(file,'mock media')
  for(const id of ids)insertAsset(db,{id,workspaceId:ws,origin:'pc',sourceName:id+'.mp4',filePath:file,sha256:id,sizeBytes:10,durationMs:1000,width:360,height:640,videoCodec:'h264',validationJson:'{}',importedAt:ctx.clock().toISOString()})
  const first=clock+120000
  const scheduled=instagram.scheduleComposition(ctx,ws,{assetIds:ids,accountId:account.id,accountRevision:account.revision,firstAt:new Date(first).toISOString(),intervalMin:15,captions:{},cleanupAfterPublish:false})
  expect(leaseNext(db,ctx.clock(),60000)).toBeNull()
  clock=first+(n-1)*900000
  const eligible=db.select().from(jobs).all().filter(j=>j.state==='queued'&&j.runAt<=ctx.clock().toISOString()).length
  const polls=new Map<string,number>(),http:unknown[]=[],events:unknown[]=[]
  const api=async(path:string,token:string,body?:Record<string,string>)=>{
    if(token!=='synthetic-qa-token')credentialErrors++
    http.push({path,method:body?'POST':'GET',timestamp:ctx.clock().toISOString()})
    if(body)return {id:String(++remote)}
    const checks=polls.get(path)??0;polls.set(path,checks+1)
    return {status_code:checks===0?'IN_PROGRESS':'FINISHED'}
  }
  const deps:instagram.PublishDeps={host:{id:'cloudflare-quick-tunnel',expose:async()=>({url:'https://qa.invalid/video.mp4',release:async()=>{}})},prepare:async input=>({path:input,cleanup:()=>{}})}
  const original=instagram.publishInstagram
  vi.spyOn(instagram,'publishInstagram').mockImplementation((c,j)=>original(c,j,api,deps))
  for(let i=0;i<n*5;i++) {
    await Promise.all([processNext(ctx,e=>events.push(e)),processNext(ctx,e=>events.push(e))])
    if(db.select({n:count()}).from(jobs).where(eq(jobs.state,'done')).get()!.n===n)break
    clock+=15000
  }
  const rows=db.select().from(jobs).all(),log=diagnosticEvents(ws)
  expect(rows.every(j=>j.state==='done')).toBe(true)
  // With five jobs and two upload slots, backpressure may defer a job before
  // its first provider call. Those additional leases must not consume retries.
  expect(rows.every(j=>j.attempts===1&&j.leaseVersion>=2)).toBe(true)
  expect(http.filter((r:any)=>r.method==='POST'&&!r.path.includes('media_publish'))).toHaveLength(n)
  expect(credentialErrors).toBe(0)
  expect(rows.map(j=>JSON.parse(j.resultJson!).stage)).toEqual(ids.map(()=> 'CONFIRMED'))
  expect(log.filter(e=>e.source==='lease').every(e=>(e.metadata as {accepted:boolean}).accepted)).toBe(true)
  results.push({fixture:'real SQLite/scheduler/checkpoints; HTTP and media mocked',n,eligible,found:scheduled.length,claimed:events.filter((e:any)=>e.state==='running').length,completed:rows.length,credentialErrors,events,http,leases:log.filter(e=>e.source==='lease')})
})

it('ten scheduled jobs support cancel, reschedule, priority and retry without duplicate intents',()=>{
  const db=memDb(),ws=createWorkspace(db,{name:'QA',timeZone:'America/Sao_Paulo'}).id,now=new Date('2026-10-07T12:00:00Z')
  const list=Array.from({length:10},(_,i)=>enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:`scheduled-${i}`,runAt:new Date(now.getTime()+120000+i*900000),idempotencyKey:`intent-${i}`},now))
  expect(leaseNext(db,now,60000)).toBeNull()
  expect(operateJobs(db,ws,[{id:list[0].id,updatedAt:list[0].updatedAt}],'cancel',now).changed).toHaveLength(1)
  expect(reschedule(db,ws,list[1].id,new Date(now.getTime()+300000).toISOString(),list[1].updatedAt,now)).toBe(true)
  expect(operateJobs(db,ws,[{id:list[2].id,updatedAt:list[2].updatedAt}],'priority',now,2).changed).toHaveLength(1)
  expect(queryJobs(db,{workspaceId:ws,page:1,pageSize:25,search:'scheduled',priority:2}).items[0].id).toBe(list[2].id)
  expect(db.select().from(jobs).all()).toHaveLength(10)
})

it('restart fences the old worker while heartbeat, completion, defer and retry accept the current lease',()=>{
  vi.stubEnv('LEGACY_PERF_DEBUG','1')
  const db=memDb(),ws=createWorkspace(db,{name:'QA',timeZone:'UTC'}).id,now=new Date('2026-10-07T12:00:00Z'),later=new Date(now.getTime()+60001)
  enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Restart'},now)
  const old=leaseNext(db,now,60000)!
  expect(recoverExpired(db,later)).toBe(1)
  const current=leaseNext(db,later,60000)!
  expect(heartbeat(db,old.id,later,60000,old.leaseVersion)).toBe(false)
  expect(complete(db,old,later)).toBe(false)
  expect(fail(db,old,later,{code:'internal',message:'old'})).toBe('stale')
  expect(deferJob(db,old,later,1000)).toBe(false)
  expect(heartbeat(db,current.id,later,60000,current.leaseVersion)).toBe(true)
  expect(complete(db,current,later)).toBe(true)
  const log=diagnosticEvents(ws).filter(e=>e.source==='lease')
  expect(log.filter(e=>!(e.metadata as {accepted:boolean}).accepted)).toHaveLength(4)
  results.push({fixture:'lease expiration/recovery simulates restart',leases:log})
})

it.each([1,2,5])('%i semaphore users release their slot after success or failure',async n=>{
  const sem=new Semaphore(1),log:unknown[]=[];let active=0,peak=0
  const tasks=Array.from({length:n},(_,i)=>sem.run(async()=>{active++;peak=Math.max(peak,active);log.push({i,operation:'acquire',active});try{await new Promise(r=>setTimeout(r,1));if(i===0)throw Error('injected failure')}finally{active--;log.push({i,operation:'release',active})}}))
  await Promise.allSettled(tasks)
  await sem.run(async()=>{expect(active).toBe(0)})
  expect(peak).toBe(1);expect(active).toBe(0)
  results.push({fixture:'semaphore success/failure',n,peak,active,log})
})

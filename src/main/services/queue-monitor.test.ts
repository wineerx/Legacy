import { expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { jobs, jobAttempts } from '../db/schema'
import { enqueue, leaseNext, fail, operateJobs, queryJobs, complete } from '../queue/queue'
import { queueContext, queueHealth } from './queue-monitor'
import { setWorkerHeartbeat } from '../diagnostics'

const setup=()=>{const db=memDb();const ws=createWorkspace(db,{name:'A',timeZone:'UTC'}).id;const other=createWorkspace(db,{name:'B',timeZone:'UTC'}).id;const now=new Date('2026-10-07T12:00:00Z');return {db,ws,other,now}}
it('loads page relations with a bounded number of SQL statements at 25, 100 and 500 rows',()=>{
  const {db,ws,now}=setup()
  for(let i=0;i<500;i++) enqueue(db,{workspaceId:ws,type:'publish_instagram',payload:{localAssetId:`missing-${i}`,username:'destination'},label:`Reel ${i}`},now)
  const sqlite=(db as unknown as {$client:{prepare(sql:string):unknown}}).$client
  const spy=vi.spyOn(sqlite,'prepare')
  try {
    for(const pageSize of [25,100,500]) {
      spy.mockClear()
      const result=queryJobs(db,{workspaceId:ws,page:1,pageSize,search:''})
      expect(result.items).toHaveLength(pageSize)
      expect(result.total).toBe(500)
      expect(spy.mock.calls.length).toBeLessThanOrEqual(9)
    }
  } finally {spy.mockRestore()}
})
it('prioritizes eligible work without changing future schedules and checks workspace and revisions',()=>{
  const {db,ws,other,now}=setup()
  const normal=enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Normal'},now)
  const urgent=enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Urgente'},now)
  const future=enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Futura',runAt:new Date(now.getTime()+60000)},now)
  expect(operateJobs(db,other,[{id:urgent.id,updatedAt:urgent.updatedAt}],'priority',now,2).skipped).toHaveLength(1)
  operateJobs(db,ws,[{id:urgent.id,updatedAt:urgent.updatedAt},{id:future.id,updatedAt:future.updatedAt}],'priority',new Date(now.getTime()+1),2)
  expect(leaseNext(db,now,60000)!.id).toBe(urgent.id)
  expect(leaseNext(db,now,60000)!.id).toBe(normal.id)
  expect(leaseNext(db,now,60000)).toBeNull()
  expect(operateJobs(db,ws,[{id:future.id,updatedAt:future.updatedAt}],'cancel',now).skipped[0].reason).toMatch(/mudou/)
})
it('detects stalled work from a real expired lease and recovers without losing checkpoints',()=>{
  const {db,ws,now}=setup()
  const j=enqueue(db,{workspaceId:ws,type:'publish_instagram',payload:{username:'destino'},label:'Publicar'},now)
  const leased=leaseNext(db,now,60000)!
  db.update(jobs).set({resultJson:JSON.stringify({containerId:'same-container',publishing:true})}).where(eq(jobs.id,j.id)).run()
  const later=new Date(now.getTime()+60001)
  const row=db.select().from(jobs).where(eq(jobs.id,j.id)).get()!
  expect(queueContext(db,row,now)).toMatchObject({stalled:false,step:4,steps:5,stage:'Confirmando publicação'})
  expect(queueContext(db,row,later)).toMatchObject({stalled:true,needsAttention:true,stage:'Travada'})
  expect(operateJobs(db,ws,[{id:j.id,updatedAt:leased.updatedAt}],'recover',now).skipped).toHaveLength(1)
  expect(operateJobs(db,ws,[{id:j.id,updatedAt:leased.updatedAt}],'recover',later).changed).toEqual([j.id])
  expect(db.select().from(jobs).where(eq(jobs.id,j.id)).get()).toMatchObject({state:'queued',resultJson:JSON.stringify({containerId:'same-container',publishing:true})})
  expect(db.select().from(jobAttempts).all()[0].outcome).toBe('lease_expired')
})
it('distinguishes retry from scheduled execution, preserves history on removal and idempotency',()=>{
  const {db,ws,now}=setup()
  const j=enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Teste',idempotencyKey:'stable'},now)
  const leased=leaseNext(db,now,60000)!
  fail(db,leased,now,{code:'internal',message:'Provider offline'},()=>0)
  const row=db.select().from(jobs).where(eq(jobs.id,j.id)).get()!
  expect(queueContext(db,row,now)).toMatchObject({stage:'Retry agendado',retryAt:row.runAt,errorCode:'internal'})
  const input={workspaceId:ws,page:1,pageSize:25,search:''}
  expect(queryJobs(db,{...input,retries:true}).items).toHaveLength(1)
  expect(operateJobs(db,ws,[{id:j.id,updatedAt:row.updatedAt}],'remove',now).skipped).toHaveLength(1)
  db.update(jobs).set({state:'failed'}).where(eq(jobs.id,j.id)).run()
  operateJobs(db,ws,[{id:j.id,updatedAt:row.updatedAt}],'remove',now)
  expect(queryJobs(db,input).total).toBe(0)
  expect(db.select().from(jobAttempts).all()).toHaveLength(1)
  expect(enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Outra',idempotencyKey:'stable'},now).id).toBe(j.id)
})
it('filters the full queue by platform, destination, priority, errors and dates',()=>{
  const {db,ws,now}=setup()
  const j=enqueue(db,{workspaceId:ws,type:'publish_instagram',payload:{username:'target'},label:'Publicar'},now)
  enqueue(db,{workspaceId:ws,type:'export_tiktok',payload:{},label:'Exportar'},now)
  const input={workspaceId:ws,page:1,pageSize:25,search:''}
  expect(queryJobs(db,{...input,platform:'instagram',destination:'target',priority:0}).items[0].id).toBe(j.id)
  expect(queryJobs(db,{...input,from:'2099-01-01T00:00:00.000Z'}).total).toBe(0)
  expect(queryJobs(db,{...input,error:'%_'}).total).toBe(0)
})
it('reports real heartbeat, completion throughput and waiting time',()=>{
  const {db,ws,now}=setup()
  enqueue(db,{workspaceId:ws,type:'make_thumbnail',payload:{},label:'Teste'},now)
  const leased=leaseNext(db,now,60000)!
  complete(db,leased,now)
  setWorkerHeartbeat(now.toISOString())
  expect(queueHealth(db,ws,true,now)).toMatchObject({healthy:true,completedLastMinute:1,busy:false,capacity:2})
  expect(queueHealth(db,ws,true,new Date(now.getTime()+11000)).healthy).toBe(false)
  setWorkerHeartbeat(null)
})

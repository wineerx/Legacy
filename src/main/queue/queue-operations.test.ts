import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { jobs, jobAttempts } from '../db/schema'
import { enqueue, leaseNext, fail, cancel, queryJobs, reschedule, tailSlot } from './queue'

let db: ReturnType<typeof memDb>, ws: string, other: string
const now = new Date('2026-10-06T12:00:00Z')
beforeEach(()=>{db=memDb();ws=createWorkspace(db,{name:'A',timeZone:'UTC'}).id;other=createWorkspace(db,{name:'B',timeZone:'UTC'}).id})
const add=(over: Partial<Parameters<typeof enqueue>[1]>={})=>enqueue(db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:'a',username:'teste',batchId:'batch-a'},label:'Reel teste',...over},now)
const failed=()=>{const j=add();const lease=leaseNext(db,now,30000)!;fail(db,lease,now,{code:'api',message:'Falhou',permanent:true});return j}
describe('operações da fila',()=>{
  it('cancela falha sem apagar histórico; não cancela execução nem outro workspace',()=>{
    const j=failed();expect(cancel(db,other,j.id,now)).toBe(false);expect(cancel(db,ws,j.id,now)).toBe(true)
    expect(db.select().from(jobAttempts).all()).toHaveLength(1)
    const running=add();leaseNext(db,now,30000);expect(cancel(db,ws,running.id,now)).toBe(false)
  })
  it('sugere final apenas das publicações da mesma conta e workspace',()=>{
    const j=failed();add({runAt:new Date(now.getTime()+3600000)})
    add({payload:{accountId:'b'},runAt:new Date(now.getTime()+7200000)})
    add({workspaceId:other,runAt:new Date(now.getTime()+10800000)})
    add({type:'download_reel',runAt:new Date(now.getTime()+14400000)})
    expect(tailSlot(db,ws,j.id,now)).toEqual({ahead:1,runAt:'2026-10-06T13:15:00.000Z'})
    expect(()=>tailSlot(db,other,j.id,now)).toThrow()
  })
  it('realoca a mesma tarefa preservando checkpoint remoto, tentativas históricas e demais horários',()=>{
    const j=failed();const checkpoint=JSON.stringify({containerId:'remote',publishing:true})
    db.update(jobs).set({resultJson:checkpoint}).where(eq(jobs.id,j.id)).run()
    const peer=add({runAt:new Date(now.getTime()+3600000)})
    const slot=tailSlot(db,ws,j.id,now)
    expect(reschedule(db,ws,j.id,slot.runAt,now.toISOString(),now)).toBe(true)
    expect(db.select().from(jobs).where(eq(jobs.id,j.id)).get()).toMatchObject({state:'queued',attempts:0,resultJson:checkpoint,runAt:slot.runAt})
    expect(db.select().from(jobAttempts).all()).toHaveLength(1)
    expect(db.select().from(jobs).where(eq(jobs.id,peer.id)).get()!.runAt).toBe(peer.runAt)
  })
  it('rejeita passado, mais de 90 dias, revisão obsoleta, tarefa running e workspace alheio',()=>{
    const j=failed();const future=new Date(now.getTime()+3600000).toISOString()
    expect(()=>reschedule(db,ws,j.id,now.toISOString(),j.updatedAt,now)).toThrow()
    expect(()=>reschedule(db,ws,j.id,new Date(now.getTime()+91*86400000).toISOString(),j.updatedAt,now)).toThrow()
    expect(()=>reschedule(db,ws,j.id,future,'2026-10-05T00:00:00Z',now)).toThrow()
    expect(()=>reschedule(db,other,j.id,future,j.updatedAt,now)).toThrow()
    const running=add();leaseNext(db,now,30000)
    expect(()=>reschedule(db,ws,running.id,future,running.updatedAt,now)).toThrow()
  })
  it('pagina mais de 500 itens com ordem estável e contagens completas',()=>{
    for(let i=0;i<521;i++) add({label:`Reel ${i}`})
    add({workspaceId:other})
    const input={workspaceId:ws,pageSize:100,search:''}
    const pages=Array.from({length:6},(_,i)=>queryJobs(db,{...input,page:i+1}))
    expect(pages[0].total).toBe(521);expect(pages[0].counts.queued).toBe(521)
    expect(new Set(pages.flatMap(p=>p.items.map(j=>j.id))).size).toBe(521)
    expect(queryJobs(db,{...input,page:999}).page).toBe(6)
  })
  it('combina filtros e busca literal sem usar % ou _ como curingas',()=>{
    const f=failed();add({label:'100%_real'});add({label:'100xxreal'})
    const input={workspaceId:ws,page:1,pageSize:25,search:'%_'}
    expect(queryJobs(db,input).total).toBe(1)
    expect(queryJobs(db,{...input,search:'teste',state:'failed'}).items[0].id).toBe(f.id)
    expect(queryJobs(db,{...input,search:'',batchId:'batch-a',type:'download_reel'}).total).toBe(0)
  })
})

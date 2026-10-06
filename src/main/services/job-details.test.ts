import { expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { jobs } from '../db/schema'
import { enqueue, leaseNext, fail } from '../queue/queue'
import { jobDetails } from './job-details'

it('mostra tentativa e checkpoint de publicação sem expor payload ou credenciais e isola workspace',()=>{
  const db=memDb(), now=new Date('2026-10-06T12:00:00Z')
  const ws=createWorkspace(db,{name:'A',timeZone:'UTC'}).id
  const other=createWorkspace(db,{name:'B',timeZone:'UTC'}).id
  const j=enqueue(db,{workspaceId:ws,type:'publish_instagram',label:'Reel',payload:{username:'conta',batchId:'lote',token:'secret-never-render'}},now)
  const lease=leaseNext(db,now,30000)!
  fail(db,lease,new Date(now.getTime()+5000),{code:'api',message:'Resposta incerta',permanent:true})
  db.update(jobs).set({resultJson:JSON.stringify({publishing:true,containerId:'123'})}).where(eq(jobs.id,j.id)).run()
  const ctx={db,dataRoot:'C:/test',clock:()=>now}
  const details=jobDetails(ctx,ws,j.id)
  expect(details).toMatchObject({attemptTotal:1,account:'conta',batchId:'lote'})
  expect(details.attempts[0]).toMatchObject({outcome:'failed',errorMessage:'Resposta incerta'})
  expect(details.checkpoint).toContain('confirme no Instagram')
  expect(JSON.stringify(details)).not.toContain('secret-never-render')
  expect(()=>jobDetails(ctx,other,j.id)).toThrow('Tarefa não encontrada')
})

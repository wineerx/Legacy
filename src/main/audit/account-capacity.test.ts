import { it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { openDb } from '../db/client'
import { MIGRATIONS_DIR } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { insertAsset } from '../repos/assets'
import { connectInstagram, instagramAccount, scheduleComposition, type PublishDeps } from '../services/instagram-publishing'
import * as instagram from '../services/instagram-publishing'
import { decryptSecret } from '../services/integrations'
import { processNext } from '../worker/handlers'
import { listJobs } from '../queue/queue'
import type { Ctx } from '../context'
import { latencyPercentiles } from '@shared/pipeline'
import { pipelineConfig } from '../pipeline-config'
import { count, eq } from 'drizzle-orm'
import { jobs } from '../db/schema'

it.skipIf(!process.env.LEGACY_CAPACITY_BENCH)('200 publications per registered account through the real state machine with mocked media/HTTP',async()=>{
  const root=mkdtempSync(join(tmpdir(),'legacy-capacity-')),results=[]
  const handles:ReturnType<typeof openDb>[]=[]
  try {
    for(const accountCount of [1,3,5,10]) {
      const h=openDb(join(root,`capacity-${accountCount}.db`),MIGRATIONS_DIR),ws=createWorkspace(h.db,{name:'capacity',timeZone:'UTC'}).id
      handles.push(h)
      let clock=Date.now(),httpCalls=0,credentialMismatches=0,remoteId=100000,active=0,peakActive=0
      const vault={available:()=>true,encrypt:(v:string)=>`enc:${v}`,decrypt:(v:string)=>v.slice(4)}
      const ctx:Ctx={db:h.db,dataRoot:root,clock:()=>new Date(clock)};ctx.secret=(w,key)=>decryptSecret(ctx,vault,w,key)
      const input=join(root,`input-${accountCount}.mp4`);writeFileSync(input,'media-transfer-mock')
      insertAsset(h.db,{id:'media',workspaceId:ws,origin:'pc',sourceName:'mock.mp4',filePath:input,sha256:'mock',sizeBytes:19,durationMs:4000,width:360,height:640,videoCodec:'h264',validationJson:'{}',importedAt:ctx.clock().toISOString()})
      for(let a=0;a<accountCount;a++) await connectInstagram(ctx,vault,ws,`credential-${a+1}`,async()=>({user_id:String(a+1),username:`account${a+1}`}))
      const enqueueStart=performance.now(),first=clock+60000
      for(let a=0;a<accountCount;a++)for(let i=0;i<200;i++) {
        const id=String(a+1),account=instagramAccount(ctx,ws,id)!
        scheduleComposition(ctx,ws,{assetIds:['media'],accountId:id,accountRevision:account.revision,firstAt:new Date(first+i*900000).toISOString(),intervalMin:15,captions:{media:`${i}`},allowRepost:true,cleanupAfterPublish:false})
      }
      const enqueueMs=performance.now()-enqueueStart
      clock=first+199*900000
      const deps:PublishDeps={host:{id:'cloudflare-quick-tunnel',expose:async()=>({url:'https://sandbox.invalid/mock.mp4',release:async()=>{}})},prepare:async input=>({path:input,cleanup:()=>{}})}
      const begin=performance.now(),durations:number[]=[],completions:number[]=[]
      const realPublish=instagram.publishInstagram
      const spy=vi.spyOn(instagram,'publishInstagram').mockImplementation(async(c,j)=>{
        const t=performance.now();active++;peakActive=Math.max(peakActive,active)
        try {
          const expected=(j.payload as {accountId:string}).accountId
          const result=await realPublish(c,j,async(path,token,body)=>{
            httpCalls++;if(token!==`credential-${expected}`)credentialMismatches++
            if(body && !path.startsWith(`${expected}/`))credentialMismatches++
            await new Promise(r=>setTimeout(r,1))
            return body?{id:String(++remoteId)}:{status_code:'FINISHED'}
          },deps)
          durations.push(performance.now()-t);completions.push(performance.now()-begin);return result
        }finally{active--}
      })
      try{await Promise.all(Array.from({length:pipelineConfig.workerConcurrency},async()=>{while(await processNext(ctx,()=>{})) { /* real scheduler claims */ }}))}finally{spy.mockRestore()}
      const elapsedMs=performance.now()-begin,total=accountCount*200
      // listJobs is intentionally paginated at 500; direct count checks the entire test dataset.
      const completeCount=h.db.select({n:count()}).from(jobs).where(eq(jobs.state,'done')).get()!
      expect(completeCount.n).toBe(total);expect(credentialMismatches).toBe(0)
      results.push({accountCount,jobsPerAccount:200,total,enqueueMs,elapsedMs,jobsPerHour:total/(elapsedMs/3600000),jobMs:latencyPercentiles(durations),completionMs:latencyPercentiles(completions),peakActive,httpCalls,credentialMismatches,failed:listJobs(h.db,ws,['failed']).length})
      h.close()
    }
    mkdirSync(resolve('docs/benchmarks'),{recursive:true});writeFileSync(resolve('docs/benchmarks/account-capacity.json'),JSON.stringify({fixture:'HTTP delay 1 ms; media preparation and transfer mocked; real SQLite claims/checkpoints/credentials/history; no external API',config:pipelineConfig,results},null,2))
  }finally{vi.restoreAllMocks();for(const h of handles) {try{h.close()}catch{ /* already closed */ }}rmSync(root,{recursive:true,force:true})}
},300000)

import { it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir, cpus, totalmem } from 'node:os'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { openDb } from '../db/client'
import { MIGRATIONS_DIR } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { enqueue, leaseNext, complete } from '../queue/queue'
import { processNext } from '../worker/handlers'
import * as instagram from '../services/instagram-publishing'
import { makeTestVideo } from '../media/test-fixtures'
import { extractFrame, renderVideoVersion } from '../media/ops'
import { preparePublishCopy } from '../media/publish-prep'
import { requestVideoVersion, planVideoVersion, saveRenderedCover } from '../services/versions'
import { insertAsset } from '../repos/assets'
import { connectInstagram, scheduleComposition } from '../services/instagram-publishing'
import { decryptSecret } from '../services/integrations'
import { pipelineConfig } from '../pipeline-config'

export function percentiles(values: number[]) {
  const v = [...values].sort((a,b) => a-b)
  const p = (n: number) => v[Math.max(0, Math.ceil(v.length*n)-1)] ?? 0
  return { p50:p(.5), p90:p(.9), p95:p(.95), p99:p(.99), max:p(1) }
}
it.skipIf(!process.env.LEGACY_BENCHMARK)('measures real SQLite/FFmpeg and mocked provider, no real posts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-audit-'))
  const loop = monitorEventLoopDelay({resolution:10}); loop.enable()
  const queue: unknown[] = [], media: unknown[] = [], storage: unknown[] = []
  const cpu = process.cpuUsage(); const started = performance.now()
  const sampleFile=join(dir,'resources.json'),stopFile=join(dir,'stop')
  const sampler=spawn('powershell.exe',['-NoProfile','-File',resolve('scripts/sample-pipeline-resources.ps1'),'-AuditParent',String(process.pid),'-AuditOutput',sampleFile,'-AuditStop',stopFile],{windowsHide:true,stdio:'ignore'})
  const sampled=new Promise<void>(resolve=>{sampler.once('close',()=>resolve());sampler.once('error',()=>resolve())})
  let peakRss = process.memoryUsage().rss
  const sample = setInterval(() => {peakRss=Math.max(peakRss,process.memoryUsage().rss)},20)
  try {
    for (const accounts of [1,3,5,10]) for (const n of [1,10,25,40,50,100,200]) {
      const file=join(dir,`queue-${accounts}-${n}.db`); const handle=openDb(file,MIGRATIONS_DIR)
      const db=handle.db, now=new Date(); const ws=createWorkspace(db,{name:'benchmark',timeZone:'UTC'}).id
      const begin=performance.now(), claims:number[]=[], lags:number[]=[], total:number[]=[]
      db.transaction(() => {for(let i=0;i<n;i++) enqueue(db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:String(i%accounts),batchId:'bench'},label:'mock'},now)})
      const enqueueMs=performance.now()-begin
      for(let i=0;i<n;i++) {
        const start=performance.now(); const job=leaseNext(db,new Date(),60000)!
        claims.push(performance.now()-start); lags.push(Date.now()-Date.parse(job.runAt))
        expect(job).toBeTruthy(); complete(db,job,new Date(),{confirmedPublished:true}); total.push(performance.now()-start)
      }
      const elapsed=performance.now()-begin
      queue.push({n,accounts,enqueueMs,claimMs:percentiles(claims),queueLagMs:percentiles(lags),jobMs:percentiles(total),jobsPerMinute:n/(elapsed/60000),elapsedMs:elapsed,failures:0})
      handle.close()
    }
    for(const n of [100,500,1000,5000]) {
      const file=join(dir,`storage-${n}.db`),h=openDb(file,MIGRATIONS_DIR),now=new Date(),ws=createWorkspace(h.db,{name:'disk',timeZone:'UTC'}).id
      h.db.transaction(()=>{for(let i=0;i<n;i++) enqueue(h.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:String(i%10),localAssetId:'fixture',caption:'benchmark',batchId:'storage'},label:'intent'},now)})
      h.close(); storage.push({jobs:n,dbBytes:statSync(file).size})
    }
    const h=openDb(join(dir,'provider.db'),MIGRATIONS_DIR),ws=createWorkspace(h.db,{name:'mock',timeZone:'UTC'}).id
    const calls=new Map<string,number>(), finishes:number[]=[]; const api=vi.spyOn(instagram,'publishInstagram').mockImplementation(async (_ctx,job)=>{
      const call=(calls.get(job.id)??0)+1;calls.set(job.id,call)
      if(call===1) throw new instagram.InstagramPending(30)
      finishes.push(performance.now());return {confirmedPublished:true} as never
    })
    const providerStart=performance.now()
    for(let i=0;i<40;i++)enqueue(h.db,{workspaceId:ws,type:'publish_instagram',payload:{accountId:String(i%10)},label:'mock pending'},new Date())
    const consume=async()=>{let passes=0;while(finishes.length<40&&passes++<1000){if(!await processNext({db:h.db,dataRoot:dir,clock:()=>new Date()},()=>{}))await new Promise(r=>setTimeout(r,5))}}
    try {await Promise.all(Array.from({length:pipelineConfig.workerConcurrency},consume))} finally {api.mockRestore();h.close()}
    expect(finishes).toHaveLength(40)
    const provider={jobs:40,accounts:10,latencyPerPollMs:30,elapsedMs:performance.now()-providerStart,completionMs:percentiles(finishes.map(t=>t-providerStart)),attemptCalls:[...calls.values()]}
    const video=join(dir,'input.mp4'),cover=join(dir,'cover.png');await makeTestVideo(video);await extractFrame(video,0,cover)
    const receipt=[]
    for(const strategy of ['eager-replay','jit']) {
      const handle=openDb(join(dir,`${strategy}.db`),MIGRATIONS_DIR),db=handle.db,ws=createWorkspace(db,{name:strategy,timeZone:'UTC'}).id
      const ctx={db,dataRoot:dir,clock:()=>new Date(),secret:(w:string,key:import('../services/integrations').SecretKey)=>decryptSecret(ctx,vault,w,key)}
      const vault={available:()=>true,encrypt:(v:string)=>`enc:${v}`,decrypt:(v:string)=>v.slice(4)}
      insertAsset(db,{id:'fixture',workspaceId:ws,origin:'pc',sourceName:'synthetic.mp4',filePath:video,sha256:'synthetic',sizeBytes:statSync(video).size,durationMs:4000,width:360,height:640,videoCodec:'mpeg4',validationJson:'{}',importedAt:new Date().toISOString()})
      const account=await connectInstagram(ctx,vault,ws,'sandbox-benchmark',async()=>({user_id:'123',username:'benchmark'})),png=readFileSync(cover)
      const t=performance.now(),first=Date.now()+3600000
      for(let i=0;i<40;i++) {
        const cv=await saveRenderedCover(ctx,ws,'fixture','benchmark',png)
        const plan=await (strategy==='jit'?planVideoVersion:requestVideoVersion)(ctx,ws,'fixture',{coverVersionId:cv.id})
        scheduleComposition(ctx,ws,{assetIds:['fixture'],accountId:account.id,accountRevision:account.revision,firstAt:new Date(first+i*900000).toISOString(),intervalMin:15,captions:{},allowRepost:true,versionIds:{fixture:plan.versionId},cleanupAfterPublish:false})
      }
      const schedulingMs=performance.now()-t,background=performance.now();let edited=0
      while(await processNext(ctx,()=>{})) edited++
      receipt.push({strategy,jobs:40,schedulingMs,backgroundPreprocessMs:performance.now()-background,editedImmediately:edited,wallMs:performance.now()-t})
      handle.close()
    }
    for(const concurrency of [1,2,4,8]) {
      const durations:number[]=[],remux:number[]=[],sizes:number[]=[];const begin=performance.now(),startedAt=Date.now()
      let next=0
      await Promise.all(Array.from({length:concurrency},async()=>{
        while(next<8){const i=next++,out=join(dir,`c${concurrency}-${i}.mp4`),t=performance.now()
          await renderVideoVersion(video,out,{coverPng:cover});durations.push(performance.now()-t);sizes.push(statSync(out).size)
          const r=performance.now(),copy=await preparePublishCopy(out,join(dir,'remux'));remux.push(performance.now()-r);copy.cleanup();rmSync(out)
        }
      }))
      media.push({concurrency,jobs:8,startedAt,finishedAt:Date.now(),concurrencyCeiling:pipelineConfig.mediaConcurrency,inputBytes:statSync(video).size,outputBytes:percentiles(sizes),ffmpegMs:percentiles(durations),remuxMs:percentiles(remux),ratio:percentiles(durations.map(ms=>ms/4000)),elapsedMs:performance.now()-begin})
    }
    const output=resolve('docs/benchmarks');mkdirSync(output,{recursive:true})
    writeFileSync(stopFile,'stop');await sampled
    const ffmpegSamples=JSON.parse(readFileSync(sampleFile,'utf8'))
    writeFileSync(join(output,`${process.env.LEGACY_BENCHMARK}.json`),JSON.stringify({mode:process.env.LEGACY_BENCHMARK,timestamp:new Date().toISOString(),hardware:{cpu:cpus()[0].model,logicalCpus:cpus().length,ramBytes:totalmem()},fixture:{width:360,height:640,durationMs:4000},queue,provider,receipt,media,storage,ffmpegSamples,resources:{peakHarnessRssBytes:peakRss,cpuMicroseconds:process.cpuUsage(cpu),wallMs:performance.now()-started,eventLoopP95Ms:loop.percentile(95)/1e6},unmeasured:['physical disk I/O (process read/write counters are sampled, not physical disk)','network I/O','real provider processing','sustainable production throughput']},null,2))
  } finally {writeFileSync(stopFile,'stop');await sampled;clearInterval(sample);loop.disable();rmSync(dir,{recursive:true,force:true})}
},300000)

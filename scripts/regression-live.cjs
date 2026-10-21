// Explicitly opt in: this posts one real Reel using the connected destination.
const { _electron: electron } = require('@playwright/test')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
if(process.env.LEGACY_REAL_PUBLISH!=='1')throw Error('Requires LEGACY_REAL_PUBLISH=1 and user authorization')
const fixture=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'legacy-media-fixture.json')))
const baseline=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'legacy-db-baseline.json')))
const account=baseline.accounts.find(a=>a.provider_id===baseline.jobs.find(j=>j.id===fixture.jobId).accountId)
const output=path.resolve('docs/benchmarks/regression');fs.mkdirSync(output,{recursive:true})
const save=(name,value)=>fs.writeFileSync(path.join(output,`live-${name}.json`),JSON.stringify(value,null,2))
;(async()=>{
 const env={...process.env,LEGACY_DATA_DIR:path.join(process.env.APPDATA,'legacy'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',LEGACY_PERF_DEBUG:'1'};delete env.ELECTRON_RUN_AS_NODE
 // Launch the package (not index.js): safeStorage's Chromium key belongs to
 // the Legacy userData profile, which is selected by the package app name.
 const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.resolve('.')],env})
 try {
  const page=await app.firstWindow();await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click();await page.getByRole('link',{name:'Biblioteca',exact:true}).waitFor()
  const scheduled=await page.evaluate(async input=>{
   const start=performance.now(),firstAt=new Date(Date.now()+120000).toISOString()
   const r=await window.legacy.invoke('compose.scheduleInstagram',{workspaceId:input.ws,assetIds:[input.asset],accountId:input.account,accountRevision:input.revision,firstAt,intervalMin:15,captions:{},cleanupAfterPublish:false,shareToFeed:true,versionIds:{[input.asset]:input.version}})
   if(!r.ok)throw Error(JSON.stringify(r.error))
   return {job:r.data[0],ipcMs:performance.now()-start,firstAt}
  },{ws:fixture.asset.workspace_id,asset:fixture.asset.id,version:fixture.version.id,account:account.provider_id,revision:account.revision})
  save('intention',scheduled);console.log('Intention '+scheduled.job.id+' saved; schedule '+scheduled.firstAt)
  await page.evaluate(async({ws,job})=>{const r=await window.legacy.invoke('jobs.bulk',{workspaceId:ws,items:[{id:job.id,updatedAt:job.updatedAt}],action:'run_now'});if(!r.ok)throw Error(JSON.stringify(r.error))},{ws:fixture.asset.workspace_id,job:scheduled.job})
  await page.getByRole('link',{name:'Fila',exact:true}).click()
  const timeline=[],metrics=[];let previous=''
  for(let i=0;i<300;i++) {
   const r=await page.evaluate(async({ws,id})=>{const jobs=await window.legacy.invoke('jobs.list',{workspaceId:ws}),diagnostics=await window.legacy.invoke('diagnostics.snapshot',{workspaceId:ws});return {job:jobs.data?.find(j=>j.id===id),events:diagnostics.data?.events.filter(e=>e.taskId===id)}},{ws:fixture.asset.workspace_id,id:scheduled.job.id})
   const marker=JSON.stringify(r.job),state=r.job?.state
   if(marker!==previous){timeline.push({timestamp:new Date().toISOString(),...r});previous=marker;save('timeline',timeline);console.log(state+' '+(r.job?.lastError||''))}
   if(i%5===0)metrics.push({at:new Date().toISOString(),processes:await app.evaluate(({app})=>app.getAppMetrics())})
   if(state==='done'||state==='failed'){save('events',r.events);save('resources',metrics);save('react-profiler',await page.evaluate(()=>globalThis.__legacyReactPerf||[]));if(state!=='done')throw Error('Real publication failed: '+r.job.lastError);console.log('CONFIRMED '+scheduled.job.id);break}
   if(i===299)throw Error('Publication did not reach terminal state within 300 s; preserve remote checkpoint')
   await new Promise(r=>setTimeout(r,1000))
  }
  const rows=await app.evaluate(({app},input)=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),DB=req('better-sqlite3'),db=new DB(input.file,{readonly:true});try{return {job:db.prepare('select id,state,lease_version,attempts,run_at,result_json from jobs where id=?').get(input.id),history:db.prepare('select * from publication_history where job_id=?').all(input.id)}}finally{db.close()}},{id:scheduled.job.id,file:path.join(process.env.APPDATA,'legacy','legacy.sqlite')})
  save('confirmation',rows)
 } finally {await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

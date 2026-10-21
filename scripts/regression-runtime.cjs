// Opt-in Electron/Chromium benchmark. Uses a SQLite backup, never the live database.
const { _electron: electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const label = process.argv[2] || 'baseline'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-regression-'))
const output = path.resolve('docs/benchmarks/regression')
fs.mkdirSync(output, {recursive:true})
const executablePath = path.resolve('node_modules/electron/dist/electron.exe')
const backupScript = path.join(root,'backup.cjs')
fs.mkdirSync(path.join(root,'data'))
fs.writeFileSync(backupScript, `const DB=require(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});const db=new DB(${JSON.stringify(path.join(process.env.APPDATA,'legacy','legacy.sqlite'))},{readonly:true});db.backup(${JSON.stringify(path.join(root,'data/legacy.sqlite'))}).then(()=>{db.close();const copy=new DB(${JSON.stringify(path.join(root,'data/legacy.sqlite'))});copy.prepare("UPDATE jobs SET state='cancelled',lease_until=null WHERE state IN ('queued','running')").run();copy.prepare("DELETE FROM settings WHERE key LIKE 'secret.%'").run();copy.close();});`)
cp.execFileSync(executablePath,[backupScript],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true})
const save=(name,data)=>fs.writeFileSync(path.join(output,`${label}-${name}.json`),JSON.stringify(data,null,2))
;(async()=>{
 const env={...process.env,LEGACY_DATA_DIR:path.join(root,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}
 delete env.ELECTRON_RUN_AS_NODE
 const app=await electron.launch({executablePath,args:[path.resolve('out/main/index.js'),'--user-data-dir='+path.join(root,'chromium')],env})
 try {
  const page=await app.firstWindow()
  await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()
  await page.getByRole('link',{name:'Biblioteca',exact:true}).waitFor()
  const ws=await page.evaluate(async()=>{const r=await window.legacy.invoke('app.bootstrap',{});return r.data.workspaces[0].id})
  await app.evaluate(({app})=>{
   const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json')
   const DB=require('better-sqlite3'),prepare=DB.prototype.prepare
   globalThis.__auditSQL=[]
   DB.prototype.prepare=function(sql){const statement=prepare.call(this,sql);for(const op of ['all','get','run']){const original=statement[op];statement[op]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{globalThis.__auditSQL.push({sql,op,ms:performance.now()-start});if(globalThis.__auditSQL.length>30000)globalThis.__auditSQL.shift()}}}return statement}
  })
  if(process.env.LEGACY_MAIN_PROFILE==='1') await app.evaluate(async()=>{
   const inspector=process.getBuiltinModule('node:inspector'),session=new inspector.Session();session.connect();globalThis.__auditInspector=session
   const post=(method)=>new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)))
   await post('Profiler.enable');await post('Profiler.start')
  })
  const cdp=await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start')
  await cdp.send('HeapProfiler.enable');await cdp.send('HeapProfiler.collectGarbage')
  await page.evaluate(()=>{
   globalThis.__audit={longTasks:[],events:[]}
   new PerformanceObserver(list=>globalThis.__audit.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})
   document.addEventListener('pointerdown',e=>{const t=performance.now();globalThis.__audit.events.push({type:'pointerdown',name:e.target.textContent?.slice(0,70),start:t});requestAnimationFrame(()=>requestAnimationFrame(()=>globalThis.__audit.events.push({type:'paint-opportunity',start:t,ms:performance.now()-t})))},true)
   const intervals=new Map(),set=window.setInterval.bind(window),clear=window.clearInterval.bind(window)
   window.setInterval=(...args)=>{const id=set(...args);intervals.set(id,args[1]||0);return id};window.clearInterval=id=>{intervals.delete(id);return clear(id)};globalThis.__auditIntervals=intervals
  })
  const queries=[]
  for(const size of [25,100]){
   await app.evaluate(()=>{globalThis.__auditSQL=[]})
   const r=await page.evaluate(async({ws,size})=>{const t=performance.now();const r=await window.legacy.invoke('jobs.query',{workspaceId:ws,page:1,pageSize:size,search:''});return {ms:performance.now()-t,ok:r.ok,items:r.data?.items.length,total:r.data?.total}},{ws,size})
   const sql=await app.evaluate(()=>globalThis.__auditSQL)
   queries.push({size,...r,queryCount:sql.length,dbMs:sql.reduce((n,q)=>n+q.ms,0),sql})
  }
  save('queries',queries)
  const countListeners=async()=>{const object=await cdp.send('Runtime.evaluate',{expression:'document'}),doc=await cdp.send('DOMDebugger.getEventListeners',{objectId:object.result.objectId}),win=await cdp.send('Runtime.evaluate',{expression:'window'}),listeners=await cdp.send('DOMDebugger.getEventListeners',{objectId:win.result.objectId});return {document:doc.listeners.length,window:listeners.listeners.length,ipc:await page.evaluate(()=>window.legacy.debugListenerCounts?.()??null),intervalsCreatedAfterInstrumentation:await page.evaluate(()=>[...globalThis.__auditIntervals.values()])}}
  await page.getByRole('link',{name:'Biblioteca',exact:true}).click();await page.getByRole('article').first().waitFor();await cdp.send('HeapProfiler.collectGarbage')
  // Observe a full bootstrap/refetch cycle before comparing timer populations.
  await page.waitForTimeout(12000)
  const listenersBefore=await countListeners(),metricsBefore=await app.evaluate(({app})=>app.getAppMetrics())
  const heapBefore=await cdp.send('Runtime.getHeapUsage')
  const interactions=[]
  for(let i=0;i<50;i++)for(const name of ['Fila','Biblioteca']){
   const start=performance.now();await page.getByRole('link',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();interactions.push({i,name,ms:performance.now()-start})
  }
  await cdp.send('HeapProfiler.collectGarbage')
  save('navigation',{heapBefore,heapAfter:await cdp.send('Runtime.getHeapUsage'),listenersBefore,listenersAfter:await countListeners(),metricsBefore,metricsAfter:await app.evaluate(({app})=>app.getAppMetrics()),interactions,renderer:await page.evaluate(()=>globalThis.__audit)})
  save('react-profiler',await page.evaluate(()=>globalThis.__legacyReactPerf||[]))
  save('renderer-cpu',(await cdp.send('Profiler.stop')).profile)
  await app.evaluate(()=>{globalThis.__auditSQL=[]})
  const idle=[]
  const seconds=Number(process.env.LEGACY_IDLE_SECONDS||20)
  for(let i=0;i<seconds;i+=5){idle.push({at:new Date().toISOString(),metrics:await app.evaluate(({app})=>app.getAppMetrics())});await new Promise(r=>setTimeout(r,5000))}
  save('idle',idle)
  save('idle-sql',await app.evaluate(()=>globalThis.__auditSQL))
  if(process.env.LEGACY_MAIN_PROFILE==='1') save('main-cpu',await app.evaluate(()=>new Promise((resolve,reject)=>globalThis.__auditInspector.post('Profiler.stop',(error,result)=>{globalThis.__auditInspector.disconnect();error?reject(error):resolve(result.profile)}))))
  if(process.env.LEGACY_COMPARE_ANIMATIONS==='1') {
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
   const reduced=[]
   for(let i=0;i<30;i+=5){reduced.push({at:new Date().toISOString(),metrics:await app.evaluate(({app})=>app.getAppMetrics())});await new Promise(r=>setTimeout(r,5000))}
   save('animation-comparison',{normal:idle,reduced})
  }
  const soakMinutes=Number(process.env.LEGACY_SOAK_MINUTES||0)
  if(soakMinutes>0) {
   const snapshot=async name=>{await cdp.send('HeapProfiler.collectGarbage');const chunks=[];const collect=({chunk})=>chunks.push(chunk);cdp.on('HeapProfiler.addHeapSnapshotChunk',collect);await cdp.send('HeapProfiler.takeHeapSnapshot');cdp.off('HeapProfiler.addHeapSnapshotChunk',collect);fs.writeFileSync(path.join(output,`${label}-${name}.heapsnapshot`),chunks.join(''));return cdp.send('Runtime.getHeapUsage')}
   const listeners=async()=>{const object=await cdp.send('Runtime.evaluate',{expression:'document'});const doc=await cdp.send('DOMDebugger.getEventListeners',{objectId:object.result.objectId});const win=await cdp.send('Runtime.evaluate',{expression:'window'});const windowListeners=await cdp.send('DOMDebugger.getEventListeners',{objectId:win.result.objectId});return {document:doc.listeners.length,window:windowListeners.listeners.length,ipc:await page.evaluate(()=>window.legacy.debugListenerCounts?.()??null)}}
   const before={heap:await snapshot('heap-before'),listeners:await listeners()},samples=[],start=Date.now()
   console.log('Starting '+soakMinutes+' minute navigation soak; idle samples: '+idle.length)
   let cycle=0
   while(Date.now()-start<soakMinutes*60000) {
    for(const name of ['Biblioteca','Perfis','Criar postagem','Fila']){await page.getByRole('link',{name,exact:true}).click();await page.waitForFunction(name=>document.querySelector('a[aria-current="page"]')?.textContent?.includes(name),name);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
    const footer=page.getByRole('button',{name:/^Diagnóstico/});await footer.click();await footer.click()
    await page.getByRole('link',{name:'Biblioteca',exact:true}).click()
    await cdp.send('HeapProfiler.collectGarbage')
    samples.push({cycle:++cycle,elapsedMs:Date.now()-start,heap:await cdp.send('Runtime.getHeapUsage'),listeners:await listeners()})
    save('soak',{before,samples});await new Promise(r=>setTimeout(r,15000))
   }
   save('soak',{before,samples,after:{heap:await snapshot('heap-after'),listeners:await listeners()},elapsedMs:Date.now()-start})
   console.log('Soak completed: '+cycle+' cycles')
  }
  console.log(JSON.stringify({label,root,queries:queries.map(({sql,...r})=>r),navigationMs:interactions.reduce((s,x)=>s+x.ms,0)/interactions.length,idleSamples:idle.length}))
 } finally {await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

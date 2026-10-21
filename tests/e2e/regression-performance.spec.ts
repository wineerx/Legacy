import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import type {IpcResult,Outputs} from '../../src/shared/ipc-contract'

test('measures queue interactions and bounded rendering at 100, 500, 1000 and 5000 jobs',async()=>{
 test.setTimeout(180000)
 const root=mkdtempSync(join(tmpdir(),'legacy-ui-regression-'))
 const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(root,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(root,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
 const samples:unknown[]=[]
 try {
  const page=await app.firstWindow()
  await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()
  await expect(page.getByRole('link',{name:'Biblioteca',exact:true})).toBeVisible()
  const ws=await page.evaluate(async()=>{const r=await window.legacy.invoke('app.bootstrap',{}) as IpcResult<Outputs['app.bootstrap']>;if(!r.ok)throw Error('bootstrap');return r.data.workspaces[0].id})
  // DOM/screenshot snapshots add ~100 ms to the action being measured on this
  // machine (saved separately in the initial failure trace). Keep API tracing
  // and the in-renderer observer during the timed pass.
  await page.context().tracing.start({screenshots:false,snapshots:false})
  const cdp=await page.context().newCDPSession(page)
  await page.evaluate(()=>{
   const audit={events:[] as {name:string;start:number;paintMs?:number}[],longTasks:[] as {start:number;duration:number}[]}
   ;(window as any).__interactionAudit=audit
   document.addEventListener('pointerdown',e=>{const row={name:(e.target as HTMLElement).textContent?.slice(0,80)||'',start:performance.now(),paintMs:0};audit.events.push(row);requestAnimationFrame(()=>requestAnimationFrame(()=>{row.paintMs=performance.now()-row.start}))},true)
   new PerformanceObserver(list=>audit.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})
  })
  for(const n of [100,500,1000,5000]) {
   await app.evaluate(({app,BrowserWindow},input)=>{
    const req=process.getBuiltinModule('node:module')!.createRequire(app.getAppPath()+'/package.json'),DB=req('better-sqlite3'),db=new DB(input.file)
    try {
     db.transaction(()=>{db.prepare('delete from jobs').run();const put=db.prepare('INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'),now=new Date().toISOString();for(let i=0;i<input.n;i++)put.run('stress-'+i,input.ws,'publish_instagram',JSON.stringify({accountId:'123',username:'qa.target',batchId:'batch-'+Math.floor(i/10),localAssetId:'missing-'+i}),'Stress reel '+i,'done',now,now,now)})()
    }finally{db.close()}
    // Direct fixture writes must emit the same invalidation as a real enqueue.
    for(const win of BrowserWindow.getAllWindows())win.webContents.send('jobs.changed',{workspaceId:input.ws})
   },{file:join(root,'data','legacy.sqlite'),ws,n})
   await page.getByRole('link',{name:'Biblioteca',exact:true}).click()
   if(n===100) {
    await page.locator('main .page-enter').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished))})
    const trigger=page.getByRole('button',{name:'Filtros de origem e publicação',exact:true}),started=performance.now()
    await trigger.click();await expect(page.getByLabel('Perfil de origem',{exact:true})).toBeVisible()
    await page.waitForFunction(()=>(window as any).__interactionAudit.events.at(-1)?.paintMs>0)
    const paintMs=await page.evaluate(()=>(window as any).__interactionAudit.events.at(-1).paintMs as number)
    expect(paintMs,'Collapsible click to paint opportunity <200 ms').toBeLessThan(200)
    samples.push({action:'expandir Collapsible',automationMs:performance.now()-started,paintMs})
    await trigger.click()
   }
   const start=performance.now()
   await page.getByRole('link',{name:'Fila',exact:true}).click()
   await expect(page.locator('.queue-table tbody tr')).toHaveCount(25)
   await expect(page.locator('.queue-pagination')).toContainText(`${n} tarefas`)
   const mountMs=performance.now()-start
   expect(mountMs,`${n} jobs: local navigation <500 ms`).toBeLessThan(500)
   // Start an independent interaction on a settled page. Playwright waits for
   // moving targets; that actionability delay is distinct from handler latency.
   await page.locator('main .page-enter').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished))})
   const more=performance.now();await page.getByRole('button',{name:'Mais filtros',exact:true}).click()
   await expect(page.getByLabel('Prioridade',{exact:true})).toBeVisible()
   const filtersAutomationMs=performance.now()-more
   await page.waitForFunction(()=>(window as any).__interactionAudit.events.at(-1)?.paintMs>0)
   const filtersMs=await page.evaluate(()=>(window as any).__interactionAudit.events.at(-1).paintMs as number)
   expect(filtersMs,'pointerdown to paint opportunity <200 ms').toBeLessThan(200)
   const search=performance.now();await page.getByLabel('Buscar job, vídeo ou conta',{exact:true}).fill('stress-0')
   await expect(page.locator('.queue-table tbody tr')).toHaveCount(1)
   const searchMs=performance.now()-search;expect(searchMs,'search <500 ms').toBeLessThan(500)
   const details=performance.now();await page.getByRole('button',{name:'Stress reel 0',exact:true}).click()
   await expect(page.getByRole('dialog',{name:'Detalhes da tarefa',exact:true})).toBeVisible()
   const detailsMs=performance.now()-details;expect(detailsMs,'details <500 ms').toBeLessThan(500)
   await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click()
   await page.getByLabel('Buscar job, vídeo ou conta',{exact:true}).fill('')
   await expect(page.locator('.queue-table tbody tr')).toHaveCount(25)
   const pagination=performance.now();await page.getByRole('button',{name:'Próxima',exact:true}).click()
   await expect(page.locator('.queue-pagination')).toContainText('Página 2')
   const paginationMs=performance.now()-pagination;expect(paginationMs).toBeLessThan(500)
   const metrics=await app.evaluate(({app})=>app.getAppMetrics())
   samples.push({n,mountMs,filtersMs,filtersAutomationMs,searchMs,detailsMs,paginationMs,renderedRows:await page.locator('.queue-table tbody tr').count(),heap:await cdp.send('Runtime.getHeapUsage'),metrics})
  }
  samples.push({renderer:await page.evaluate(()=>(window as any).__interactionAudit),reactProfiler:await page.evaluate(()=>(window as any).__legacyReactPerf??[])})
 } finally {
  mkdirSync(resolve('docs/benchmarks/regression'),{recursive:true})
  writeFileSync(resolve('docs/benchmarks/regression/ui-stress.json'),JSON.stringify(samples,null,2))
  await app.context().tracing.stop({path:resolve('docs/benchmarks/regression/ui-stress-trace.zip')}).catch(()=>{})
  await app.close()
 }
})

import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'

test('diagnostics with 2000 real events renders a bounded page and searches older events',async()=>{
 test.setTimeout(120000)
 const dir=mkdtempSync(join(tmpdir(),'legacy-diagnostic-perf-')),baseline=process.env.LEGACY_DIAG_BASELINE==='1'
 const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(dir,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(dir,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
 const result:Record<string,unknown>={baseline}
 try {const page=await app.firstWindow();await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click();await page.getByRole('link',{name:'Biblioteca',exact:true}).waitFor()
 const ws=await page.evaluate(async()=>{const r:any=await window.legacy.invoke('app.bootstrap',{});return r.data.workspaces[0].id})
 await app.evaluate(async({app},ws)=>{const req=process.getBuiltinModule('node:module')!.createRequire(app.getAppPath()+'/package.json'),fs=req('node:fs'),path=req('node:path'),record=fs.readdirSync(path.join(app.getAppPath(),'chunks')).map((n:string)=>Object.values(req(path.join(app.getAppPath(),'chunks',n)))).flat().find((f:any)=>typeof f==='function'&&f.name==='recordDiagnostic') as (e:any)=>void /* any shared chunk: names depend on bundling */;if(!record)throw Error('Diagnostic export unavailable');(globalThis as any).__regressionRecord=record;for(let i=0;i<2000;i++)record({workspaceId:ws,source:'ipc',level:'DEBUG',message:'audit-log-'+String(i).padStart(4,'0'),metadata:{index:i,detail:'retained event '+i}})},ws)
 await page.waitForTimeout(2100)
 const open=performance.now();await page.getByRole('button',{name:/^Diagnóstico/}).click();await expect(page.getByRole('tab',{name:'Console',exact:true})).toBeVisible();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 result.openMs=performance.now()-open;result.rows=await page.locator('.diagnostic-entry').count();result.nodes=await page.locator('.diagnostic-panel *').count()
 if(!baseline){expect(result.openMs).toBeLessThan(500);expect(result.rows).toBeLessThanOrEqual(25)}
 const search=performance.now();await page.getByLabel('Buscar logs',{exact:true}).fill('audit-log-0050');await expect(page.locator('.diagnostic-entry mark').first()).toHaveText('audit-log-0050');result.searchMs=performance.now()-search
 if(!baseline){expect(result.searchMs).toBeLessThan(500);expect(await page.locator('.diagnostic-entry').count()).toBeLessThanOrEqual(25)}
 if(!baseline){
  await page.getByLabel('Buscar logs',{exact:true}).fill('')
  await app.evaluate((_,ws)=>{for(let i=0;i<2000;i++)(globalThis as any).__regressionRecord({workspaceId:ws,source:'ipc',level:'DEBUG',message:'Repeated event',metadata:{detail:'audit-log-'+String(i).padStart(4,'0')}})},ws)
  await page.waitForTimeout(2100)
  await page.getByLabel('Buscar logs',{exact:true}).fill('audit-log-0050')
  await expect(page.locator('.diagnostic-entry mark').first()).toHaveText('audit-log-0050')
  result.groupedOccurrenceNodes=await page.locator('.diagnostic-entry .diagnostic-details').count()
  expect(await page.locator('.diagnostic-panel *').count()).toBeLessThan(1000)
  await page.getByRole('button',{name:'Ocorrências anteriores',exact:true}).click()
  await expect(page.getByRole('button',{name:'Ocorrências seguintes',exact:true})).toBeEnabled()
 }
 } finally {mkdirSync('docs/benchmarks/regression',{recursive:true});writeFileSync(`docs/benchmarks/regression/diagnostics-${baseline?'before':'after'}.json`,JSON.stringify(result,null,2));await app.close()}
})

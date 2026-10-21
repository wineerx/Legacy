import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Channel, Input, Outputs, IpcResult } from '../../src/shared/ipc-contract'

test('multi-account destinations and JIT intentions cross real IPC without eager editing',async()=>{
  const root=mkdtempSync(join(tmpdir(),'legacy-jit-ui-')),video=join(root,'video.mp4'),png=join(root,'cover.png'),dbFile=join(root,'data','legacy.sqlite')
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=2','-c:v','libopenh264',video],{windowsHide:true})
  execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'),['-y','-v','error','-i',video,'-frames:v','1',png],{windowsHide:true})
  const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(root,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(root,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
  try {
    const page=await app.firstWindow();await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()
    await expect(page.getByRole('link',{name:'Biblioteca',exact:true})).toBeVisible()
    const seeded=await page.evaluate(async input=>{
      const invoke=async <C extends Channel>(channel:C,input:Input<C>)=>await window.legacy.invoke(channel,input) as IpcResult<Outputs[C]>
      const boot=await invoke('app.bootstrap',{});if(!boot.ok)throw Error('boot');const ws=boot.data.workspaces[0].id
      const imported=await invoke('library.importPaths',{workspaceId:ws,paths:[input]});if(!imported.ok)throw Error(`import: ${JSON.stringify(imported.error)}`)
      return {ws,asset:imported.data[0].assetId!}
    },video)
    await app.evaluate(({safeStorage,app},input)=>{
      const require=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`),Database=require('better-sqlite3'),db=new Database(input.file)
      try {
        const account={id:'111',username:'sandbox.a',revision:'revision-a',validatedAt:new Date().toISOString()}
        const put=db.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(input.ws,'instagramAccount',JSON.stringify(account))
        for(const [id,user,revision] of [['111','sandbox.a','revision-a'],['222','sandbox.b','revision-b']]) {
          db.prepare("INSERT INTO destination_accounts(workspace_id,provider,provider_id,username,revision,validated_at) VALUES(?,'instagram',?,?,?,?)").run(input.ws,id,user,revision,new Date().toISOString())
          put.run(input.ws,`secret.instagramToken:${id}`,safeStorage.encryptString(`synthetic-${id}`).toString('base64'))
        }
      } finally {db.close()}
    },{file:dbFile,ws:seeded.ws})
    // The first-steps popover opens over the sidebar after entry; close it before clicking menu links.
    { const close=page.getByRole('button',{name:'Fechar primeiros passos',exact:true}); if(await close.isVisible()) await close.click() }
    await page.getByRole('link',{name:'Contas',exact:true}).click()
    await expect(page.getByRole('main').getByText('@sandbox.a',{exact:true})).toBeVisible();await expect(page.getByRole('main').getByText('@sandbox.b',{exact:true})).toBeVisible()
    await page.getByRole('link',{name:'Biblioteca',exact:true}).click();await page.getByRole('article').first().getByRole('checkbox').check();await page.getByRole('button',{name:'Preparar lote',exact:true}).click()
    await page.getByLabel('Conta de destino Instagram').selectOption('222')
    await expect(page.getByRole('checkbox',{name:'Instagram — @sandbox.b',exact:true})).toBeEnabled()
    const planned=await page.evaluate(async input=>{
      const invoke=async <C extends Channel>(channel:C,input:Input<C>)=>await window.legacy.invoke(channel,input) as IpcResult<Outputs[C]>
      const cover=await invoke('versions.saveCover',{workspaceId:input.ws,assetId:input.asset,templateId:'sandbox',png:new Uint8Array(input.png)});if(!cover.ok)throw Error(cover.error.message)
      const plan=await invoke('versions.planVideo',{workspaceId:input.ws,assetId:input.asset,coverVersionId:cover.data.versionId});if(!plan.ok)throw Error(plan.error.message)
      const scheduled=await invoke('compose.scheduleInstagram',{workspaceId:input.ws,assetIds:[input.asset],accountId:'222',accountRevision:'revision-b',firstAt:new Date(Date.now()+3600000).toISOString(),intervalMin:15,captions:{},cleanupAfterPublish:false,shareToFeed:true,versionIds:{[input.asset]:plan.data.versionId}});if(!scheduled.ok)throw Error(scheduled.error.message)
      const jobs=await invoke('jobs.list',{workspaceId:input.ws});if(!jobs.ok)throw Error('jobs')
      return {versionId:plan.data.versionId,publicationJobs:jobs.data.filter(j=>j.type==='publish_instagram').length,editingJobs:jobs.data.filter(j=>j.type==='apply_banner').length}
    },{...seeded,png:[...readFileSync(png)]})
    expect(planned).toMatchObject({publicationJobs:1,editingJobs:0})
    // Foundation only: exercise all Container channels through the existing preload, no new screens.
    const controlled=await page.evaluate(async input=>{
      const invoke=async <C extends Channel>(channel:C,raw:unknown):Promise<Outputs[C]>=>{
        const result=await window.legacy.invoke(channel,raw) as IpcResult<Outputs[C]>
        if(!result.ok)throw Error(`${channel}: ${result.error.message}`)
        return result.data
      }
      const initial=await invoke('containers.query',{workspaceId:input.ws})
      const existing=await invoke('containers.get',{workspaceId:input.ws,containerId:initial.items[0].id})
      const created=await invoke('containers.create',{workspaceId:input.ws,requestId:input.requestId,draft:{name:'Teste IPC'}})
      const draft={name:'Teste IPC',provider:'instagram',destinationAccountId:'111',accountRevision:'revision-a',
        plannedStartAt:new Date(Date.now()+86400000).toISOString(),intervalMin:15,captionBase:'Base',items:[{assetId:input.asset}]}
      const updated=await invoke('containers.updateDraft',{workspaceId:input.ws,containerId:created.container.id,expectedRevision:1,draft})
      const mutation={workspaceId:input.ws,containerId:created.container.id,expectedRevision:updated.container.revision}
      const scheduled=await invoke('containers.schedule',mutation)
      const replay=await invoke('containers.schedule',mutation)
      const paused=await invoke('containers.pause',{...mutation,expectedRevision:scheduled.detail.container.revision})
      const resumed=await invoke('containers.resume',{...mutation,expectedRevision:paused.container.revision})
      const cancelled=await invoke('containers.cancel',{...mutation,expectedRevision:resumed.container.revision})
      const filtered=await invoke('containers.query',{workspaceId:input.ws,state:'cancelled'})
      return {initialTotal:initial.total,jitRecipe:existing.items[0].recipeVersionId,replaySame:scheduled.jobs[0].id===replay.jobs[0].id,
        paused:paused.container.state,resumed:resumed.container.state,cancelled:cancelled.container.state,filteredTotal:filtered.total}
    },{...seeded,requestId:randomUUID()})
    expect(controlled).toMatchObject({initialTotal:1,jitRecipe:planned.versionId,replaySame:true,paused:'paused',resumed:'scheduled',cancelled:'cancelled',filteredTotal:1})
    const version=await app.evaluate(({app},input)=>{
      const require=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`),Database=require('better-sqlite3'),db=new Database(input.file)
      try{return db.prepare('SELECT file_path FROM media_versions WHERE id=?').get(input.id) as {file_path:string}}finally{db.close()}
    },{file:dbFile,id:planned.versionId})
    expect(existsSync(version.file_path)).toBe(false);expect(existsSync(video)).toBe(true)
  } finally {await app.close()}
})

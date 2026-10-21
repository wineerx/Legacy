import type { IpcResult,Outputs } from '../../src/shared/ipc-contract'
import { desktopViewport } from './helpers'
import { test,expect,_electron as electron } from '@playwright/test'
import { mkdtempSync,readFileSync,readdirSync,mkdirSync,unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildSync } from 'esbuild'

test('Builder → versão → Container independente → JIT real e retry, sem publicação externa',async()=>{
  test.setTimeout(180000)
  const dir=mkdtempSync(join(tmpdir(),'legacy-template-builder-')),video=join(dir,'fixture.mp4'),ff=resolve('resources/bin/win32-x64/ffmpeg.exe')
  execFileSync(ff,['-y','-v','error','-f','lavfi','-i','color=red:s=360x640:r=30:d=2','-c:v','libopenh264',video])
  const original=readFileSync(video)
  const helper=resolve(`out/main/template-e2e-${Date.now()}.cjs`)
  buildSync({stdin:{contents:`export {materializeVersion} from './src/main/services/versions'; export {openDb} from './src/main/db/client'; export {createVisualRenderer} from './src/main/ipc/visual-renderer';`,resolveDir:resolve('.')},outfile:helper,bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'@shared':resolve('src/shared')},logLevel:'silent'})
  const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(dir,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(dir,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
  try{
    const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
    await desktopViewport(app, page)
    await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible()
    const ws=await page.evaluate(async()=>{const r=await window.legacy.invoke('app.bootstrap',{}) as IpcResult<Outputs['app.bootstrap']>;if(!r.ok)throw Error('boot');return r.data.workspaces[0].id})
    await app.evaluate(({app,safeStorage},args)=>{
      const require=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`),Database=require('better-sqlite3'),db=new Database(args.db)
      try{
        const put=db.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
        put.run(args.ws,'instagramAccount',JSON.stringify({id:'123456',username:'qa.builder',revision:'qa-revision',validatedAt:new Date().toISOString()}));put.run(args.ws,'secret.instagramToken',safeStorage.encryptString('synthetic-token').toString('base64'))
        const insert=db.prepare("INSERT INTO media_assets(id,workspace_id,origin,source_name,file_path,sha256,size_bytes,duration_ms,width,height,video_codec,audio_codec,validation_json,imported_at) VALUES(?,?,'pc',?,?,?,1000,2000,360,640,'h264','none','{}',?)")
        for(let n=0;n<9;n++)insert.run(`builder-${n}`,args.ws,`Fixture ${n}`,args.video,`fixture-sha-${n}`,new Date(Date.now()+n*1000).toISOString())
      }finally{db.close()}
    },{ws,video,db:join(dir,'data','legacy.sqlite')})
    await page.getByRole('link',{name:'Templates',exact:true}).click()
    await page.getByRole('button',{name:'Novo Template',exact:true}).click()
    await page.getByLabel('Nome do Template',{exact:true}).fill('Meme QA')
    await page.getByLabel('Largura do canvas',{exact:true}).fill('360');await page.getByLabel('Altura do canvas',{exact:true}).fill('640')
    await page.getByRole('combobox',{name:'Elemento selecionado',exact:true}).click();await page.getByRole('option',{name:'Mídia · media',exact:true}).click()
    await page.getByLabel('X (px)',{exact:true}).fill('20');await page.getByLabel('Y (px)',{exact:true}).fill('160');await page.getByLabel('Largura (px)',{exact:true}).fill('320');await page.getByLabel('Altura (px)',{exact:true}).fill('320');await page.getByLabel('Radius (px)',{exact:true}).fill('30')
    // Direct selection, drag and resize retain numeric precision controls.
    const box=await page.getByRole('button',{name:'Selecionar media media',exact:true}).boundingBox();if(!box)throw Error('box')
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+10,box.y+box.height/2+10,{steps:3});await page.mouse.up()
    await expect(page.getByLabel('X (px)',{exact:true})).not.toHaveValue('20')
    await page.getByLabel('X (px)',{exact:true}).fill('20');await page.getByLabel('Y (px)',{exact:true}).fill('160')
    const handle=await page.getByRole('button',{name:'Redimensionar media',exact:true}).boundingBox();if(!handle)throw Error('resize')
    await page.mouse.move(handle.x+1,handle.y+1);await page.mouse.down();await page.mouse.move(handle.x+11,handle.y+11,{steps:3});await page.mouse.up()
    await expect(page.getByLabel('Largura (px)',{exact:true})).not.toHaveValue('320');await page.getByLabel('Largura (px)',{exact:true}).fill('320');await page.getByLabel('Altura (px)',{exact:true}).fill('320')
    await page.getByRole('button',{name:'+ Texto',exact:true}).click();await page.getByLabel('Texto do bloco',{exact:true}).fill('{{custom_text}}')
    await page.getByLabel('X (px)',{exact:true}).fill('20');await page.getByLabel('Y (px)',{exact:true}).fill('40');await page.getByLabel('Largura (px)',{exact:true}).fill('320');await page.getByLabel('Altura (px)',{exact:true}).fill('100');await page.getByLabel('Tamanho da fonte (px)',{exact:true}).fill('26');await page.getByLabel('Valor de custom_text',{exact:true}).fill('Texto dinâmico QA')
    await page.getByRole('button',{name:'Selecionar mídias da Biblioteca',exact:true}).click()
    for(let n=0;n<9;n++)await page.getByRole('button',{name:`Fixture ${n}`,exact:true}).click()
    await page.getByRole('button',{name:'Concluir seleção',exact:true}).click()
    await page.getByRole('button',{name:'Preview em grade',exact:true}).click();await expect(page.getByTestId('template-profile-grid').locator('canvas')).toHaveCount(9)
    await page.getByRole('button',{name:'Preview individual',exact:true}).click()
    await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThanOrEqual(2)
    // legacy-media intentionally retains its origin boundary. Compare a screenshot, without weakening CORS.
    const previewPng=join(dir,'preview.png'),previewRaw=join(dir,'preview.rgb')
    await page.getByLabel('Composição do Template').screenshot({path:previewPng})
    execFileSync(ff,['-y','-v','error','-i',previewPng,'-vf','scale=360:640','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',previewRaw])
    const preview=readFileSync(previewRaw)
    await page.getByRole('button',{name:'Salvar versão',exact:true}).dblclick();await expect(page.getByText('Versão 1 salva. Containers existentes permanecem iguais.',{exact:true})).toBeVisible()
    const t=await page.evaluate(async ws=>{const r=await window.legacy.invoke('templates.query',{workspaceId:ws}) as IpcResult<Outputs['templates.query']>;if(!r.ok)throw Error('query');return r.data.items[0]},ws)
    expect(t.version).toBe(1)
    expect(readdirSync(join(dir,'data'),{recursive:true}).some(v=>String(v).includes('processed'))).toBe(false)
    await page.getByRole('button',{name:'Voltar aos Templates',exact:true}).click();await page.getByRole('link',{name:'Biblioteca',exact:true}).click()
    await page.getByRole('button',{name:'Selecionar página',exact:true}).click();await page.getByRole('button',{name:'Criar novo Container',exact:true}).click()
    await page.getByLabel('Nome do Container',{exact:true}).fill('Builder Container')
    await page.getByRole('combobox',{name:'Destino do Container',exact:true}).click();await page.getByRole('option',{name:'Instagram · @qa.builder',exact:true}).click()
    await page.getByRole('button',{name:'Configuração visual',exact:true}).click();await page.getByRole('combobox',{name:'Template visual',exact:true}).click();await page.getByRole('option',{name:'Meme QA v1',exact:true}).click();await page.getByRole('button',{name:'Aplicar Template ao rascunho',exact:true}).click()
    await expect(page.getByText('Origem: Meme QA v1. Cópia independente.',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Salvar rascunho',exact:true}).click();await expect(page.getByText('Rascunho salvo. Nenhum job foi criado e nenhum vídeo foi processado.',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Fechar',exact:true}).click()
    const frozen=await page.evaluate(async({ws,t})=>{
      const list=await window.legacy.invoke('containers.query',{workspaceId:ws,state:'draft'}) as IpcResult<Outputs['containers.query']>;if(!list.ok)throw Error('list');const c=list.data.items[0]
      const detail=await window.legacy.invoke('containers.get',{workspaceId:ws,containerId:c.id}) as IpcResult<Outputs['containers.get']>;if(!detail.ok)throw Error('detail')
      const updated=await window.legacy.invoke('containers.updateDraft',{workspaceId:ws,containerId:c.id,expectedRevision:c.revision,draft:{name:c.name,destinationAccountId:c.destinationAccountId,provider:c.provider,accountRevision:c.accountRevision,visualSnapshot:c.visualSnapshot,plannedStartAt:new Date(Date.now()+3*86400000).toISOString(),items:detail.data.items.map(v=>({assetId:v.assetId!}))}}) as IpcResult<Outputs['containers.updateDraft']>;if(!updated.ok)throw Error(JSON.stringify(updated))
      const scheduled=await window.legacy.invoke('containers.schedule',{workspaceId:ws,containerId:c.id,expectedRevision:updated.data.container.revision}) as IpcResult<Outputs['containers.schedule']>;if(!scheduled.ok)throw Error(JSON.stringify(scheduled))
      const edit=await window.legacy.invoke('templates.saveVersion',{workspaceId:ws,templateId:t.id,expectedRevision:t.revision,requestId:crypto.randomUUID(),input:{name:'Changed',description:'Changed',visual:{...t.visual,...(t.visual.version===2?{layout:{...t.visual.layout,background:'#000000'}}:{})}}}) as IpcResult<Outputs['templates.saveVersion']>;if(!edit.ok)throw Error(JSON.stringify(edit))
      const archived=await window.legacy.invoke('templates.archive',{workspaceId:ws,templateId:t.id,expectedRevision:edit.data.template.revision,archived:true}) as IpcResult<Outputs['templates.archive']>;if(!archived.ok)throw Error('archive')
      await window.legacy.invoke('templates.delete',{workspaceId:ws,templateId:t.id,expectedRevision:archived.data.template.revision})
      const again=await window.legacy.invoke('containers.get',{workspaceId:ws,containerId:c.id}) as IpcResult<Outputs['containers.get']>;if(!again.ok)throw Error('again')
      await window.legacy.invoke('containers.cancel',{workspaceId:ws,containerId:c.id,expectedRevision:again.data.container.revision})
      return {before:scheduled.data.detail.container.visualSnapshot,after:again.data.container.visualSnapshot,jobId:scheduled.data.jobs[0].id}
    },{ws,t})
    expect(frozen.before).toEqual(frozen.after)
    const jit=await app.evaluate(async({app},args)=>{
      const require=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`),helper=require(args.helper)
      const {db,close}=helper.openDb(args.db,args.migrations),adapter=helper.createVisualRenderer({rendererDir:args.renderer})
      let renders=0
      try{
        const row=db.$client.prepare('SELECT payload_json FROM jobs WHERE id=?').get(args.jobId),payload=JSON.parse(row.payload_json)
        const ctx={db,dataRoot:args.dataRoot,clock:()=>new Date(),renderVisual:async(layout:unknown)=>{renders++;return adapter.render(layout)}}
        const first=await helper.materializeVersion(ctx,args.ws,payload.localAssetId,payload.versionId),second=await helper.materializeVersion(ctx,args.ws,payload.localAssetId,payload.versionId)
        return {first,second,renders}
      }finally{adapter.dispose();close()}
    },{helper,db:join(dir,'data','legacy.sqlite'),dataRoot:join(dir,'data'),migrations:resolve('src/main/db/migrations'),renderer:resolve('out/renderer'),jobId:frozen.jobId,ws})
    expect(jit.first).toBe(jit.second);expect(jit.renders).toBe(1)
    const raw=join(dir,'jit.rgb');execFileSync(ff,['-y','-v','error','-ss','0','-i',jit.first,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',raw]);const pixels=readFileSync(raw)
    let delta=0;for(let i=0;i<360*640;i++)for(let channel=0;channel<3;channel++)delta+=Math.abs(pixels[i*3+channel]-preview[i*3+channel])
    expect(delta/(360*640*3)).toBeLessThan(8)
    expect(readFileSync(video)).toEqual(original);expect(errors).toEqual([])
    mkdirSync('docs/screens/qa-templates',{recursive:true});await page.getByRole('link',{name:'Templates',exact:true}).click();await page.screenshot({path:'docs/screens/qa-templates/after-snapshot.png'})
  }finally{await app.close();unlinkSync(helper)}
})

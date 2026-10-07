import type {IpcResult,Outputs} from '../../src/shared/ipc-contract'
import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtempSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'

test('destinos, calendário, fila real, modal de contas e sidebar acessível',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-publishing-ui-'));const video=join(dir,'destino.mp4')
 execFileSync(resolve('resources/bin/win32-x64/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=2','-c:v','libopenh264',video])
 const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(dir,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(dir,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
 try{
 const page=await app.firstWindow()
  await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()
;await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible()
 const seeded=await page.evaluate(async source=>{
  const boot=await window.legacy.invoke('app.bootstrap',{}) as IpcResult<Outputs['app.bootstrap']>;if(!boot.ok)throw Error('boot');const ws=boot.data.workspaces[0].id
  const imported=await window.legacy.invoke('library.importPaths',{workspaceId:ws,paths:[source]}) as IpcResult<Outputs['library.importPaths']>;if(!imported.ok)throw Error('import')
  const profile=await window.legacy.invoke('profiles.add',{workspaceId:ws,url:'instagram.com/qa.source'}) as IpcResult<Outputs['profiles.add']>;if(!profile.ok)throw Error('profile')
  const post=await window.legacy.invoke('profiles.addReel',{workspaceId:ws,profileId:profile.data.id,url:'https://www.instagram.com/reel/QAABCDE/'}) as IpcResult<Outputs['profiles.addReel']>;if(!post.ok)throw Error('post')
  return {ws,assetId:imported.data[0].assetId!,postId:post.data.id}
 },video)
 // Only synthetic test credentials are seeded. All schedule IPC, SQLite and queue code stay real.
 await app.evaluate(({safeStorage,app},input)=>{
  const require=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
  const Database=require('better-sqlite3')
  const db=new Database(input.db);try{
   const put=db.prepare('INSERT INTO settings(workspace_id,key,value) VALUES(?,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value')
   put.run(input.ws,'instagramAccount',JSON.stringify({id:'123456',username:'qa.destino',revision:'qa-rev',validatedAt:new Date().toISOString()}))
   put.run(input.ws,'secret.instagramToken',safeStorage.encryptString('qa-synthetic-token').toString('base64'))
   put.run(input.ws,`remoteMedia.${input.postId}`,JSON.stringify({videoUrl:'https://scontent.cdninstagram.com/qa.mp4'}))
   db.prepare('UPDATE remote_posts SET asset_id=? WHERE workspace_id=? AND id=?').run(input.assetId,input.ws,input.postId)
  }finally{db.close()}
 },{...seeded,db:join(dir,'data','legacy.sqlite')})
 await page.getByRole('link',{name:'Contas',exact:true}).click()
 await page.getByRole('button',{name:'Conectar conta',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Conectar uma conta'})).toBeVisible()
 mkdirSync('docs/screens/qa-publishing',{recursive:true});await page.screenshot({path:'docs/screens/qa-publishing/conectar-conta.png'})
 await page.getByLabel('Fechar',{exact:true}).click()
 await page.getByRole('link',{name:'Biblioteca',exact:true}).click()
 // Menu de ações: precisa continuar ancorado ao card e clicável depois que o mouse sai do card.
 const card=page.getByRole('article').first()
 await card.hover()
 await card.getByRole('button',{name:'Ações da mídia'}).click()
 const menuItem=page.getByRole('button',{name:'Visualizar e ver detalhes'})
 await expect(menuItem).toBeVisible()
 // Radix pode inverter o lado para manter o menu dentro de janelas menores.
 await expect.poll(async()=>{
  const trigger=await card.getByRole('button',{name:'Ações da mídia'}).boundingBox()
  const menu=await menuItem.evaluate(el=>{const r=el.closest('[data-side]')!.getBoundingClientRect();return {y:r.y,bottom:r.bottom}})
  return Math.min(Math.abs(menu.y-(trigger!.y+trigger!.height)),Math.abs(menu.bottom-trigger!.y))
 }).toBeLessThan(12)
 await page.screenshot({path:'docs/screens/qa-publishing/menu-acoes.png'})
 await menuItem.click()
 await expect(page.getByRole('dialog')).toBeVisible()
 await page.keyboard.press('Escape')
 // Checkbox do card não pode ficar coberto pelos selos.
 await card.getByRole('checkbox').click()
 await expect(card.getByRole('checkbox')).toBeChecked()
 await card.getByRole('checkbox').click()
 await page.getByRole('button',{name:'Selecionar página',exact:true}).click()
 await page.getByRole('button',{name:'Preparar lote',exact:true}).click()
 await page.getByRole('checkbox',{name:'Instagram — @qa.destino',exact:true}).check()
 await expect(page.getByRole('checkbox',{name:'TikTok — exportação manual',exact:true})).not.toBeChecked()
 await page.getByText('Nova capa',{exact:true}).click()
 await page.getByLabel('Texto da capa').fill('EP 1 — capa no primeiro frame')
 await page.getByRole('button',{name:'Criar capa com frame e texto',exact:true}).click()
 await expect(page.getByRole('img',{name:'Prévia da capa'})).toBeVisible()
 await page.screenshot({path:'docs/screens/qa-publishing/previa-capa.png'})
 await page.getByRole('button',{name:'Grade',exact:true}).click()
 await expect(page.getByRole('img',{name:'Prévia da grade do perfil'})).toBeVisible()
 await page.getByRole('img',{name:'Prévia da grade do perfil'}).screenshot({path:'docs/screens/qa-publishing/previa-grade.png'})
 await expect(page.getByRole('button',{name:'Revisar lote',exact:true})).toHaveAttribute('aria-disabled','true')
 await page.getByRole('button',{name:'Sem capa',exact:true}).click()
 await page.getByLabel('Data',{exact:true}).click()
 await page.getByRole('button',{name:new RegExp(`, ${new Date(Date.now()+86400000).getDate()} de `)}).click()
 await page.getByRole('radio',{name:'18:30',exact:true}).click()
 await page.getByRole('button',{name:'Revisar lote',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Revisar lote'})).toContainText('Instagram — @qa.destino')
 await page.screenshot({path:'docs/screens/qa-publishing/revisar-instagram.png'})
 await page.getByRole('button',{name:'Agendar no Instagram',exact:true}).click()
 // Instagram agenda a cópia local sem edições; nenhuma edição é enviada silenciosamente.
 await expect(page.getByRole('heading',{name:'Fila',exact:true})).toBeVisible({timeout:30_000})
 const queued=await page.evaluate(async ws=>{const result=await window.legacy.invoke('jobs.list',{workspaceId:ws}) as IpcResult<Outputs['jobs.list']>;if(!result.ok)throw Error('jobs');const job=result.data.find(j=>j.type==='publish_instagram');if(!job)throw Error('No publication job');await window.legacy.invoke('jobs.cancel',{workspaceId:ws,id:job.id});return {type:job.type,state:job.state,label:job.label,edit:result.data.some(j=>j.type==='apply_banner'),tiktok:result.data.some(j=>j.type==='export_tiktok')}},seeded.ws)
 expect(queued).toMatchObject({type:'publish_instagram',state:'queued',label:'Publicar reel em @qa.destino',edit:false,tiktok:false})
 await page.getByRole('button',{name:'Recolher menu',exact:true}).click()
 await page.getByRole('link',{name:'Biblioteca',exact:true}).hover()
 await expect(page.getByRole('tooltip',{name:'Biblioteca',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Menu do usuário'}).click()
 await expect(page.getByRole('button',{name:'Configurações',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Sair do Legacy',exact:true})).toBeVisible()
 await page.screenshot({path:'docs/screens/qa-publishing/sidebar-recolhida.png'})
 }finally{await app.close()}
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('monitor compacto, detalhe lateral, operações em massa, filtros e layout menor',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'legacy-queue-ui-'))
  const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('out/main/index.js'),'--user-data-dir='+join(dir,'chromium')],env:{...process.env,LEGACY_DATA_DIR:join(dir,'data'),LEGACY_DISABLE_DESKTOP_NOTIFICATIONS:'1',APIFY_TOKEN:''}})
  try {
    const page=await app.firstWindow()
  await page.getByRole('button',{name:'Entrar como visitante',exact:true}).click()

    await expect(page.getByRole('heading',{name:'Visão geral',exact:true})).toBeVisible()
    const ws=await page.evaluate(async()=>{
      const boot=await window.legacy.invoke('app.bootstrap',{}) as IpcResult<Outputs['app.bootstrap']>
      if(!boot.ok)throw Error('boot');return boot.data.workspaces[0].id
    })
    await page.evaluate(async workspaceId=>{const result=await window.legacy.invoke('jobs.pause',{workspaceId,paused:true}) as IpcResult<Outputs['jobs.pause']>;if(!result.ok)throw Error(result.error.message)},ws)
    mkdirSync(join(dir,'data','workspaces',ws),{recursive:true})
    copyFileSync(resolve('resources/icon.png'),join(dir,'data','workspaces',ws,'qa-thumbnail.png'))
    await app.evaluate(({app},input)=>{
      const req=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const db=new (req('better-sqlite3'))(input.db)
      try {
        const now=new Date().toISOString(),future=new Date(Date.now()+3600000).toISOString()
        db.prepare('INSERT INTO tracked_profiles(id,workspace_id,platform,username,url,created_at) VALUES(?,?,?,?,?,?)').run('qa-source',input.ws,'instagram','qa.source','https://www.instagram.com/qa.source/',now)
        db.prepare('INSERT INTO remote_posts(id,workspace_id,profile_id,permalink,caption,thumbnail_path) VALUES(?,?,?,?,?,?)').run('qa-post',input.ws,'qa-source','https://www.instagram.com/reel/QAABCDE/','Vídeo de origem QA',input.thumbnail)
        const insert=db.prepare('INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,attempts,max_attempts,last_error,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        for(let i=0;i<51;i++) {
          const state=i<2 ? 'failed' : i<4 ? 'queued' : 'done'
          insert.run(`qa-job-${i}`,input.ws,'publish_instagram',JSON.stringify({accountId:'qa-account',username:'qa.destino',batchId:'qa-batch',...(i===2?{postId:'qa-post'}:{})}),`Reel QA ${i}`,state,future,state==='queued' ? 0 : 1,5,state==='failed' ? 'Resposta incerta da plataforma' : null,state==='failed' ? JSON.stringify({containerId:'qa-container',publishing:true}) : null,now,now)
        }
        db.prepare('INSERT INTO job_attempts(id,job_id,started_at,finished_at,outcome,error_code,error_message) VALUES(?,?,?,?,?,?,?)').run('qa-attempt','qa-job-0',now,now,'failed','api','Resposta incerta da plataforma')
      } finally {db.close()}
    },{ws,db:join(dir,'data','legacy.sqlite'),thumbnail:join(dir,'data','workspaces',ws,'qa-thumbnail.png')})
    await page.getByRole('link',{name:'Fila',exact:true}).click()
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('checkbox',{name:/Selecionar tarefa/})).toHaveCount(25)
    await expect(page.getByText('Worker pausado',{exact:true})).toBeVisible()
    await expect(page.getByText('51 tarefas · Página 1 de 3')).toBeVisible()
    await page.getByRole('button',{name:'Próxima'}).click()
    await expect(page.getByText('51 tarefas · Página 2 de 3')).toBeVisible()
    await page.getByLabel('Estado',{exact:true}).click()
    await page.getByRole('option',{name:'Falhou',exact:true}).click()
    await expect(page.getByRole('checkbox',{name:/Selecionar tarefa/})).toHaveCount(2)
    await page.getByRole('button',{name:'Reel QA 0',exact:true}).click()
    const sheet=page.getByRole('dialog',{name:'Detalhes da tarefa'})
    await expect(sheet.getByText(/confirme no Instagram/)).toBeVisible()
    await sheet.getByRole('tab',{name:'Execuções',exact:true}).click()
    await expect(sheet.getByText(/1 execuções registradas/)).toBeVisible()
    mkdirSync('docs/screens/qa-queue',{recursive:true})
    await page.screenshot({path:'docs/screens/qa-queue/falha.png'})
    await sheet.getByRole('button',{name:'Fechar detalhes',exact:true}).click()
    await page.getByRole('button',{name:'Ações de qa-job-0',exact:true}).click()
    await page.getByRole('button',{name:'Passar a vez',exact:true}).click()
    const move=page.getByRole('dialog',{name:'Reagendar tarefas',exact:true})
    await expect(move.getByText('2 tarefas pendentes antes do horário sugerido.')).toBeVisible()
    await expect(move.getByRole('button',{name:'Confirmar novo horário'})).toBeEnabled()
    await page.screenshot({path:'docs/screens/qa-queue/realocar.png'})
    await move.getByRole('button',{name:'Confirmar novo horário'}).click()
    await expect(move).toHaveCount(0)
    await expect(page.getByRole('checkbox',{name:/Selecionar tarefa/})).toHaveCount(1)
    await page.getByRole('button',{name:'Ações de qa-job-1',exact:true}).click()
    await page.getByRole('button',{name:'Cancelar',exact:true}).click()
    await page.getByRole('button',{name:'Confirmar cancelamento'}).click()
    await expect(page.getByRole('heading',{name:'Nada na fila',exact:true})).toBeVisible()
    const query=await page.evaluate(async workspaceId=>window.legacy.invoke('jobs.query',{workspaceId,page:1,pageSize:100,search:'QA'}),ws) as IpcResult<Outputs['jobs.query']>
    expect(query.ok).toBe(true)
    if(!query.ok)throw Error('query')
    expect(query.data.items.find(j=>j.id==='qa-job-0')?.state).toBe('queued')
    expect(query.data.items.find(j=>j.id==='qa-job-1')?.state).toBe('cancelled')
    const detail=await page.evaluate(async workspaceId=>window.legacy.invoke('jobs.details',{workspaceId,id:'qa-job-0'}),ws) as IpcResult<Outputs['jobs.details']>
    expect(detail.ok && detail.data.attemptTotal).toBe(1)
    expect(detail.ok && detail.data.checkpoint).toContain('confirme no Instagram')
    await page.getByRole('button',{name:'Limpar filtros'}).click()
    await page.screenshot({path:'docs/screens/qa-queue/monitor.png'})
    await page.getByRole('button',{name:'Lotes',exact:true}).click()
    await page.getByRole('button',{name:'Ver lote completo'}).click()
    await expect(page.getByRole('button',{name:'Remover filtro: Lote qa-batch'})).toBeVisible()
    await page.getByRole('checkbox',{name:'Selecionar página'}).check()
    await expect(page.getByText('25 selecionada(s)',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Limpar seleção'}).click()
    await page.setViewportSize({width:1000,height:760})
    await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0)
    await page.screenshot({path:test.info().outputPath('arvore-1000.png')})
    await page.setViewportSize({width:1440,height:900})
    await page.getByRole('button',{name:'Limpar filtros'}).click()
    await page.getByRole('button',{name:'Tabela',exact:true}).click()
    await page.getByLabel('Estado',{exact:true}).click()
    await page.getByRole('option',{name:'Na fila',exact:true}).click()
    await expect(page.getByRole('checkbox',{name:/Selecionar tarefa/})).toHaveCount(3)
    const sourced=page.getByRole('row',{name:'Reel QA 2',exact:true})
    await expect(sourced.getByText('@qa.source',{exact:true})).toBeVisible()
    await expect(sourced.getByRole('img',{name:'Miniatura do vídeo'})).toBeVisible()
    await expect.poll(()=>sourced.getByRole('img').evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('checkbox',{name:'Selecionar página'}).check()
    await page.getByLabel('Alterar prioridade',{exact:true}).click()
    await page.getByRole('option',{name:'Urgente',exact:true}).click()
    await page.getByRole('dialog',{name:'Confirmar operação'}).getByRole('button',{name:'Confirmar',exact:true}).click()
    await expect(sourced.getByText('Urgente',{exact:true})).toBeVisible()
    await page.screenshot({path:'docs/screens/qa-queue/monitor.png'})
    await page.getByRole('checkbox',{name:'Selecionar página'}).check()
    await page.getByRole('region',{name:'Operações em massa'}).getByRole('button',{name:'Cancelar',exact:true}).click()
    await page.getByRole('button',{name:'Confirmar cancelamento'}).click()
    await expect(page.getByRole('heading',{name:'Nada na fila',exact:true})).toBeVisible()
    const verified=await page.evaluate(async workspaceId=>window.legacy.invoke('jobs.query',{workspaceId,page:1,pageSize:100,search:'',state:'cancelled'}),ws) as IpcResult<Outputs['jobs.query']>
    expect(verified.ok && verified.data.total).toBe(4)
    const mediaSearch=await page.evaluate(async workspaceId=>window.legacy.invoke('jobs.query',{workspaceId,page:1,pageSize:100,search:'Vídeo de origem QA'}),ws) as IpcResult<Outputs['jobs.query']>
    expect(mediaSearch.ok && mediaSearch.data.items.map(job=>job.id)).toEqual(['qa-job-2'])
  } finally {await app.close()}
})

import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IpcResult, Outputs } from '../../src/shared/ipc-contract'

test('fila paginada, árvore, falha, cancelamento, realocação e layout menor',async()=>{
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
    await app.evaluate(({app},input)=>{
      const req=process.getBuiltinModule('node:module')!.createRequire(`${app.getAppPath()}/package.json`)
      const db=new (req('better-sqlite3'))(input.db)
      try {
        const now=new Date().toISOString(),future=new Date(Date.now()+3600000).toISOString()
        const insert=db.prepare('INSERT INTO jobs(id,workspace_id,type,payload_json,label,state,run_at,attempts,max_attempts,last_error,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        for(let i=0;i<51;i++) {
          const state=i<2 ? 'failed' : i<4 ? 'queued' : 'done'
          insert.run(`qa-job-${i}`,input.ws,'publish_instagram',JSON.stringify({accountId:'qa-account',username:'qa.destino',batchId:'qa-batch'}),`Reel QA ${i}`,state,future,state==='queued' ? 0 : 1,5,state==='failed' ? 'Resposta incerta da plataforma' : null,state==='failed' ? JSON.stringify({containerId:'qa-container',publishing:true}) : null,now,now)
        }
        db.prepare('INSERT INTO job_attempts(id,job_id,started_at,finished_at,outcome,error_code,error_message) VALUES(?,?,?,?,?,?,?)').run('qa-attempt','qa-job-0',now,now,'failed','api','Resposta incerta da plataforma')
      } finally {db.close()}
    },{ws,db:join(dir,'data','legacy.sqlite')})
    await page.getByRole('link',{name:'Fila',exact:true}).click()
    await expect(page.getByRole('article')).toHaveCount(25)
    await expect(page.getByText('51 tarefas · Página 1 de 3')).toBeVisible()
    await page.getByRole('button',{name:'Próxima'}).click()
    await expect(page.getByText('51 tarefas · Página 2 de 3')).toBeVisible()
    await page.getByLabel('Estado',{exact:true}).click()
    await page.getByRole('option',{name:'Falhou',exact:true}).click()
    await expect(page.getByRole('article')).toHaveCount(2)
    const failure=page.getByRole('article',{name:'Reel QA 0',exact:true})
    await failure.getByRole('button', {name:'Andamento e tentativas'}).click()
    await expect(failure.getByText(/Histórico de tentativas: 1/)).toBeVisible()
    await expect(failure.getByText(/confirme no Instagram/)).toBeVisible()
    mkdirSync('docs/screens/qa-queue',{recursive:true})
    await page.screenshot({path:'docs/screens/qa-queue/falha.png'})
    await failure.getByRole('button',{name:'Passar a vez'}).click()
    const move=page.getByRole('dialog',{name:'Passar a vez',exact:true})
    await expect(move.getByText('2 tarefas pendentes antes do horário sugerido.')).toBeVisible()
    await expect(move.getByRole('button',{name:'Confirmar novo horário'})).toBeEnabled()
    await page.screenshot({path:'docs/screens/qa-queue/realocar.png'})
    await move.getByRole('button',{name:'Confirmar novo horário'}).click()
    await expect(move).toHaveCount(0)
    await expect(page.getByRole('article')).toHaveCount(1)
    await page.getByRole('article').getByRole('button',{name:'Cancelar'}).click()
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
    await page.getByRole('button',{name:'Árvore de lotes'}).click()
    await page.getByRole('button',{name:'Ver lote completo'}).click()
    await expect(page.getByText('Filtrando o lote qa-batch')).toBeVisible()
    await page.setViewportSize({width:1000,height:760})
    await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0)
    await page.screenshot({path:'docs/screens/qa-queue/arvore-1000.png'})
  } finally {await app.close()}
})

import { expect, it, vi } from 'vitest'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { buildHandlers } from '../ipc/handlers'
import { createDispatcher } from '../ipc/dispatcher'
import { randomUUID } from 'node:crypto'
import { createTemplate,saveTemplateVersion,readTemplate,listTemplates,duplicateTemplate,archiveTemplate,deleteTemplate,applyTemplate } from './visual-templates'
import { createContainer,readContainer,scheduleContainer,updateContainerDraft } from './publication-containers'
import { insertAsset,listVersions } from '../repos/assets'
import { jobs,visualTemplateVersions } from '../db/schema'
import { connectInstagram } from './instagram-publishing'
import { decryptSecret } from './integrations'
import { blankLayout,newElement } from '@shared/visual-layout'
import { frozenRecipeVisual } from './container-visual'
import * as toolRunner from '../media/run'
const fixture=()=>{const ctx={db:memDb(),dataRoot:'unused',clock:()=>new Date('2026-10-09T12:00:00Z')};const ws=createWorkspace(ctx.db,{name:'Templates',timeZone:'UTC'}).id;return {ctx,ws}}
const input=(name='Clean')=>({name,visual:{version:2 as const,layout:blankLayout(),context:{}}})

it('versions are immutable; create/save/duplicate replies can be replayed after source changes',()=>{
  const {ctx,ws}=fixture(),requestId=randomUUID(),original=createTemplate(ctx,ws,requestId,input())
  expect(createTemplate(ctx,ws,requestId,input())).toEqual(original)
  expect(()=>createTemplate(ctx,ws,requestId,input('Other'))).toThrow(/outra configuração/)
  const duplicateRequest=randomUUID(),copy=duplicateTemplate(ctx,ws,original.template.id,duplicateRequest)
  expect(copy.template.id).not.toBe(original.template.id)
  const saveRequest=randomUUID(),v2=saveTemplateVersion(ctx,ws,original.template.id,1,saveRequest,input('Dark'))
  expect(v2.template.version).toBe(2)
  expect(readTemplate(ctx,ws,original.template.id,1).template.name).toBe('Clean')
  expect(saveTemplateVersion(ctx,ws,original.template.id,1,saveRequest,input('Dark'))).toEqual(v2)
  expect(duplicateTemplate(ctx,ws,original.template.id,duplicateRequest)).toEqual(copy)
  expect(()=>saveTemplateVersion(ctx,ws,original.template.id,1,randomUUID(),input())).toThrow(/mudou/)
  expect(ctx.db.select().from(visualTemplateVersions).all()).toHaveLength(3)
})
it('archive and delete never mutate copies; all repository operations enforce workspace boundaries',()=>{
  const {ctx,ws}=fixture(),other=createWorkspace(ctx.db,{name:'Other',timeZone:'UTC'}).id,t=createTemplate(ctx,ws,randomUUID(),input())
  const d=createContainer(ctx,ws,randomUUID(),{name:'Draft'})
  const applied=applyTemplate(ctx,ws,d.container.id,1,{name:'Draft',items:[]},t.template.id,1)
  expect(applied.container.visualSnapshot).toMatchObject({source:{templateId:t.template.id,templateVersion:1}})
  const archived=archiveTemplate(ctx,ws,t.template.id,1,true)
  expect(listTemplates(ctx,ws,{}).items).toHaveLength(0)
  expect(()=>applyTemplate(ctx,ws,d.container.id,2,{name:'Draft'},t.template.id,1)).toThrow(/arquivado/)
  expect(()=>readTemplate(ctx,other,t.template.id)).toThrow(/workspace/)
  expect(()=>duplicateTemplate(ctx,other,t.template.id,randomUUID())).toThrow(/workspace/)
  expect(()=>archiveTemplate(ctx,other,t.template.id,archived.template.revision,true)).toThrow(/workspace/)
  expect(()=>deleteTemplate(ctx,other,t.template.id,archived.template.revision)).toThrow(/workspace/)
  deleteTemplate(ctx,ws,t.template.id,archived.template.revision)
  expect(readContainer(ctx,ws,d.container.id).container.visualSnapshot).toEqual(applied.container.visualSnapshot)
})
it('application rollback is integral, and draft operations never call media tools or create recipes/jobs',()=>{
  const {ctx,ws}=fixture(),tool=vi.spyOn(toolRunner,'runTool'),t=createTemplate(ctx,ws,randomUUID(),input()),d=createContainer(ctx,ws,randomUUID(),{name:'Draft'})
  expect(()=>applyTemplate(ctx,ws,d.container.id,1,{name:'Bad',items:[{assetId:'missing'}]},t.template.id,1)).toThrow(/Vídeo/)
  expect(readContainer(ctx,ws,d.container.id)).toEqual(d)
  expect(ctx.db.select().from(jobs).all()).toHaveLength(0);expect(tool).not.toHaveBeenCalled();tool.mockRestore()
})
it('schedule freezes effective dynamic text and individual overrides independently of future versions and deletion',async()=>{
  const {ctx:base,ws}=fixture(),ctx:import('../context').Ctx=base
  const vault={available:()=>true,encrypt:(s:string)=>`protected:${s}`,decrypt:(s:string)=>s.slice(10)}
  ctx.secret=(workspace,key)=>decryptSecret(ctx,vault,workspace,key)
  const account=await connectInstagram(ctx,vault,ws,'synthetic',vi.fn().mockResolvedValue({id:'111',user_id:'111',username:'qa'}))
  insertAsset(ctx.db,{id:'a',workspaceId:ws,origin:'pc',sourceName:'a.mp4',filePath:'untouched.mp4',sha256:'fixture',sizeBytes:1,durationMs:3000,width:360,height:640,videoCodec:'h264',validationJson:'{}',importedAt:ctx.clock().toISOString()})
  const text={...newElement('text','caption'),type:'text' as const,text:'{{caption}}',font:'Inter' as const,weight:700 as const,fontSize:48,lineHeight:1.2,color:'#000000',align:'left' as const,padding:8}
  const t=createTemplate(ctx,ws,randomUUID(),{...input(),visual:{...input().visual,layout:{...blankLayout(),elements:[...blankLayout().elements,text]}}})
  const draft={name:'Draft',provider:'instagram' as const,destinationAccountId:'111',accountRevision:account.revision,plannedStartAt:'2026-10-10T16:00:00Z',captionBase:'base',items:[{assetId:'a',captionOverride:'individual'}]}
  const d=createContainer(ctx,ws,randomUUID(),draft),a=applyTemplate(ctx,ws,d.container.id,1,draft,t.template.id,1),scheduled=scheduleContainer(ctx,ws,d.container.id,2)
  const recipe=JSON.parse(listVersions(ctx.db,ws,'a')[0].paramsJson)
  const visual=frozenRecipeVisual(ctx,ws,recipe)
  expect(visual.layout?.elements.find(e=>e.id==='caption')).toMatchObject({text:'individual'})
  expect(scheduled.detail.items[0].effectiveCaption).toBe('individual')
  saveTemplateVersion(ctx,ws,t.template.id,1,randomUUID(),input('changed'));deleteTemplate(ctx,ws,t.template.id,2)
  expect(frozenRecipeVisual(ctx,ws,recipe)).toEqual(visual)
  expect(readContainer(ctx,ws,d.container.id).container.visualSnapshot).toEqual(a.container.visualSnapshot)
  expect(()=>applyTemplate(ctx,ws,d.container.id,3,draft,t.template.id,1)).toThrow()
  expect(ctx.db.select().from(jobs).all()).toHaveLength(1)
})

it('creates version 1 through real IPC without jobs or media tools', async () => {
  const ctx = { db:memDb(), dataRoot:'unused', clock:()=>new Date('2026-10-09T12:00:00Z') }
  const ws=createWorkspace(ctx.db,{name:'Templates',timeZone:'UTC'}).id
  const handlers=buildHandlers({ctx,dialogs:{pickVideos:async()=>[],pickImage:async()=>null,pickMetricsFile:async()=>null},shell:{openPath:async()=>''},workerAlive:()=>false,version:'test',onJobsChanged:()=>{}})
  const dispatch=createDispatcher(handlers)
  const result=await dispatch('templates.create',{workspaceId:ws,requestId:randomUUID(),input:{name:'Clean',visual:{version:1}}})
  expect(result.ok).toBe(true)
  if(result.ok) expect((result.data as any).template.version).toBe(1)
})

it('search treats %, _ and backslash in names as literals, scoped to the current version name',()=>{
  const {ctx,ws}=fixture()
  for(const name of ['100% dark','100 dark','meme_v2','memeXv2','a\\b','ab'])createTemplate(ctx,ws,randomUUID(),input(name))
  const names=(text:string)=>listTemplates(ctx,ws,{text}).items.map(t=>t.name).sort()
  expect(names('100%')).toEqual(['100% dark'])
  expect(names('_v2')).toEqual(['meme_v2'])
  expect(names('\\')).toEqual(['a\\b'])
  expect(names('DARK')).toEqual(['100 dark','100% dark'])
})

it('a locally applied copy is verified on save: forged, renamed, foreign or newly archived origins roll back',()=>{
  const {ctx,ws}=fixture(),other=createWorkspace(ctx.db,{name:'Other',timeZone:'UTC'}).id
  const t=createTemplate(ctx,ws,randomUUID(),input()),foreign=createTemplate(ctx,other,randomUUID(),input('Foreign'))
  const copy=(source:{templateId:string;templateVersion:number;templateName:string})=>({name:'Draft',visualSnapshot:{...t.template.visual,source}})
  const valid={templateId:t.template.id,templateVersion:1,templateName:'Clean'}
  expect(()=>createContainer(ctx,ws,randomUUID(),copy({...valid,templateId:randomUUID()}))).toThrow(/não encontrado/)
  expect(()=>createContainer(ctx,ws,randomUUID(),copy({...valid,templateName:'Forged'}))).toThrow(/não confere/)
  expect(()=>createContainer(ctx,ws,randomUUID(),copy({...valid,templateId:foreign.template.id,templateName:'Foreign'}))).toThrow(/workspace/)
  // Local adjustments after applying are allowed: only the origin is checked, not the bytes.
  const adjusted={...copy(valid),visualSnapshot:{...copy(valid).visualSnapshot,layout:{...blankLayout(),background:'#123456'}}}
  const d=createContainer(ctx,ws,randomUUID(),adjusted)
  const other2=createContainer(ctx,ws,randomUUID(),{name:'Plain'})
  archiveTemplate(ctx,ws,t.template.id,1,true)
  expect(updateContainerDraft(ctx,ws,d.container.id,1,{...adjusted,name:'Still editable'}).container.name).toBe('Still editable')
  expect(()=>updateContainerDraft(ctx,ws,other2.container.id,1,copy(valid))).toThrow(/arquivado/)
  expect(readContainer(ctx,ws,other2.container.id)).toEqual(other2)
})

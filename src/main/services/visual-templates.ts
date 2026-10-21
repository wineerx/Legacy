import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { templateInput } from '@shared/visual-templates'
import { containerDraftInput, type ContainerDraftInput } from '@shared/publication-containers'
import { AppError } from '@shared/errors'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { visualTemplates as templates, visualTemplateVersions as versions, visualTemplateRequests as requests } from '../db/schema'
import { getTemplate, templateRow, queryTemplates } from '../repos/visual-templates'
import { requireWorkspace } from './integrations'
import { updateContainerDraft } from './publication-containers'

const immediate={behavior:'immediate'} as const
function intent<T>(ctx:Ctx,ws:string,requestId:string,value:unknown,action:()=>T):T {
  const fingerprint=createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const prior=ctx.db.select().from(requests).where(and(eq(requests.workspaceId,ws),eq(requests.requestId,requestId))).get()
  if(prior){if(prior.fingerprint!==fingerprint)throw new AppError('duplicate','Esta requisição já foi usada com outra configuração.');return JSON.parse(prior.resultJson)}
  const result=action();ctx.db.insert(requests).values({workspaceId:ws,requestId,fingerprint,resultJson:JSON.stringify(result)}).run();return result
}
const check=(revision:number,expected:number)=>{if(revision!==expected)throw new AppError('invalid_input','O Template mudou. Atualize antes de salvar.')}
export function createTemplate(ctx:Ctx,ws:string,requestId:string,input:z.input<typeof templateInput>) {
  requireWorkspace(ctx,ws);const value=templateInput.parse(input)
  return ctx.db.transaction(()=>intent(ctx,ws,requestId,{create:value},()=>{
    const id=newId(),now=ctx.clock().toISOString();ctx.db.insert(templates).values({id,workspaceId:ws,createdAt:now,updatedAt:now}).run()
    ctx.db.insert(versions).values({workspaceId:ws,templateId:id,version:1,name:value.name,description:value.description,visualJson:JSON.stringify(value.visual),createdAt:now}).run()
    return getTemplate(ctx.db,ws,id)
  }),immediate)
}
export function saveTemplateVersion(ctx:Ctx,ws:string,id:string,expected:number,requestId:string,input:z.input<typeof templateInput>) {
  requireWorkspace(ctx,ws);const value=templateInput.parse(input)
  return ctx.db.transaction(()=>intent(ctx,ws,requestId,{id,expected,value},()=>{
    const row=templateRow(ctx.db,ws,id);check(row.revision,expected)
    if(row.status!=='active')throw new AppError('invalid_input','Desarquive o Template antes de editar.')
    const version=row.currentVersion+1,now=ctx.clock().toISOString()
    ctx.db.insert(versions).values({workspaceId:ws,templateId:id,version,name:value.name,description:value.description,visualJson:JSON.stringify(value.visual),createdAt:now}).run()
    ctx.db.update(templates).set({currentVersion:version,revision:row.revision+1,updatedAt:now}).where(and(eq(templates.workspaceId,ws),eq(templates.id,id))).run()
    return getTemplate(ctx.db,ws,id)
  }),immediate)
}
export function readTemplate(ctx:Ctx,ws:string,id:string,version?:number){requireWorkspace(ctx,ws);return getTemplate(ctx.db,ws,id,version)}
export function listTemplates(ctx:Ctx,ws:string,q:Parameters<typeof queryTemplates>[2]){requireWorkspace(ctx,ws);return queryTemplates(ctx.db,ws,q)}
export function duplicateTemplate(ctx:Ctx,ws:string,id:string,requestId:string,version?:number){
  requireWorkspace(ctx,ws)
  return ctx.db.transaction(()=>intent(ctx,ws,requestId,{duplicate:id,version},()=>{
    const value=getTemplate(ctx.db,ws,id,version).template
    return createTemplate(ctx,ws,newId(),{name:`${value.name.slice(0,112)} (cópia)`,description:value.description,visual:value.visual})
  }),immediate)
}
export function archiveTemplate(ctx:Ctx,ws:string,id:string,expected:number,archived:boolean){
  requireWorkspace(ctx,ws);return ctx.db.transaction(()=>{const row=templateRow(ctx.db,ws,id);check(row.revision,expected);ctx.db.update(templates).set({status:archived?'archived':'active',revision:row.revision+1,updatedAt:ctx.clock().toISOString()}).where(and(eq(templates.workspaceId,ws),eq(templates.id,id))).run();return getTemplate(ctx.db,ws,id)},immediate)
}
export function deleteTemplate(ctx:Ctx,ws:string,id:string,expected:number){requireWorkspace(ctx,ws);return ctx.db.transaction(()=>{check(templateRow(ctx.db,ws,id).revision,expected);ctx.db.delete(templates).where(and(eq(templates.workspaceId,ws),eq(templates.id,id))).run();return {deleted:true}},immediate)}
export function applyTemplate(ctx:Ctx,ws:string,id:string,expected:number,draft:ContainerDraftInput,templateId:string,version:number){
  requireWorkspace(ctx,ws);return ctx.db.transaction(()=>{
    const value=getTemplate(ctx.db,ws,templateId,version).template
    if(value.status!=='active')throw new AppError('invalid_input','Template arquivado não pode ser aplicado novamente.')
    const visual=value.visual.version===2?{...value.visual,source:{templateId,templateVersion:version,templateName:value.name}}:value.visual
    return updateContainerDraft(ctx,ws,id,expected,containerDraftInput.parse({...draft,visualSnapshot:visual}))
  },immediate)
}

import { and, eq, desc, count, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { visualTemplates as templates, visualTemplateVersions as versions } from '../db/schema'
import { AppError } from '@shared/errors'
import { containerVisualSnapshot } from '@shared/container-visual'
import type { TemplateDetail, TemplatePage } from '@shared/visual-templates'
export function templateRow(db:Db,ws:string,id:string) {
  const row=db.select().from(templates).where(and(eq(templates.workspaceId,ws),eq(templates.id,id))).get()
  if(!row)throw new AppError('not_found','Template não encontrado neste workspace.')
  return row
}
export function getTemplate(db:Db,ws:string,id:string,version?:number):TemplateDetail {
  const row=templateRow(db,ws,id)
  const list=db.select().from(versions).where(and(eq(versions.workspaceId,ws),eq(versions.templateId,id))).orderBy(desc(versions.version)).all()
  const value=list.find(v=>v.version===(version??row.currentVersion))
  if(!value)throw new AppError('not_found','Versão do Template não encontrada.')
  return {template:{id:row.id,workspaceId:ws,version:value.version,revision:row.revision,status:row.status,name:value.name,description:value.description,visual:containerVisualSnapshot.parse(JSON.parse(value.visualJson)),createdAt:row.createdAt,updatedAt:row.updatedAt},versions:list.map(v=>({version:v.version,name:v.name,createdAt:v.createdAt}))}
}
export function queryTemplates(db:Db,ws:string,q:{status?:'active'|'archived'|'all';text?:string;page?:number;pageSize?:number}):TemplatePage {
  const scope=and(eq(templates.workspaceId,ws),q.status==='all'?undefined:eq(templates.status,q.status??'active'),q.text?sql`${versions.name} LIKE ${`%${q.text.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`} ESCAPE '\\'`:undefined)
  const join=and(eq(templates.workspaceId,versions.workspaceId),eq(templates.id,versions.templateId),eq(templates.currentVersion,versions.version))
  const ids=db.select({id:templates.id}).from(templates).innerJoin(versions,join).where(scope).orderBy(desc(templates.updatedAt),templates.id).limit(q.pageSize??20).offset(((q.page??1)-1)*(q.pageSize??20)).all()
  const total=db.select({n:count()}).from(templates).innerJoin(versions,join).where(scope).get()!.n
  return {items:ids.map(v=>getTemplate(db,ws,v.id).template),total}
}

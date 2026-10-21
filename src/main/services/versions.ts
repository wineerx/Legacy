import { mkdir, writeFile, readFile, rename, rm, stat, readdir, utimes } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import type { JobView } from '@shared/types'
import type { Ctx } from '../context'
import { newId } from '../db/client'
import { enqueue } from '../queue/queue'
import { getAsset, insertVersion, listVersions, type AssetVersion } from '../repos/assets'
import { storedAssetDir } from './library'
import { mediaVersions, jobs } from '../db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { renderVideoVersion, renderComposition, extractFrame } from '../media/ops'
import { probe } from '../media/probe'
import { workspaceDir, resolveInside } from '../paths'
import { pipelineConfig } from '../pipeline-config'
import { recordDiagnostic } from '../diagnostics'
import { frozenRecipeVisual } from './container-visual'
import { pngDimensions } from '@shared/container-visual'
import { RENDERER_VERSION } from '@shared/visual-layout'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function assertPng(bytes: Uint8Array): void {
  if (bytes.length > 20 * 1024 * 1024) throw new AppError('invalid_input', 'Imagem acima de 20 MB.')
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new AppError('invalid_input', 'A imagem precisa ser PNG.')
}

async function versionsDir(ctx: Ctx, ws: string, assetId: string): Promise<string> {
  if (!getAsset(ctx.db, ws, assetId)) throw new AppError('not_found', 'Vídeo não encontrado.')
  const dir = join(storedAssetDir(ctx, ws, assetId), 'versions')
  await mkdir(dir, { recursive: true })
  return dir
}

export async function saveRenderedCover(ctx: Ctx, ws: string, assetId: string, templateId: string, png: Uint8Array): Promise<AssetVersion> {
  assertPng(png)
  const dir = await versionsDir(ctx, ws, assetId)
  const id = newId()
  const filePath = join(dir, `cover-${id}.png`)
  await writeFile(filePath, png)
  return insertVersion(ctx.db, { id, workspaceId: ws, assetId, kind: 'cover_png', paramsJson: JSON.stringify({ templateId }), filePath, createdAt: ctx.clock().toISOString() })
}

export type VideoVersionRequest = { banner?: { png: Uint8Array; startMs: number; endMs: number }; coverVersionId?: string }

/** Convert only queued edits referenced by queued publications. Running and standalone edits are untouched. */
export function migrateLegacyPublicationRecipes(ctx: Ctx): number {
  return ctx.db.transaction(tx=>{
    const legacy=tx.select().from(jobs).where(and(eq(jobs.type,'apply_banner'),eq(jobs.state,'queued'),sql`exists(select 1 from jobs pub where pub.workspace_id = ${jobs.workspaceId} and pub.type = 'publish_instagram' and pub.state = 'queued' and json_extract(pub.payload_json, '$.versionId') = json_extract(${jobs.payloadJson}, '$.versionId'))`)).all()
    let migrated=0
    for(const job of legacy) {
      const p=JSON.parse(job.payloadJson),asset=getAsset(tx,job.workspaceId,p.assetId)
      if(!asset || !p.versionId) continue
      insertVersion(tx,{id:p.versionId,workspaceId:job.workspaceId,assetId:p.assetId,kind:'banner',filePath:join(storedAssetDir(ctx,job.workspaceId,p.assetId),'versions',`planned-${p.versionId}.mp4`),paramsJson:JSON.stringify({pending:true,bannerPath:p.bannerPath,coverPath:p.coverPath,startMs:p.startMs,endMs:p.endMs,processingVersion:1}),createdAt:job.createdAt})
      tx.update(jobs).set({state:'cancelled',updatedAt:ctx.clock().toISOString()}).where(and(eq(jobs.id,job.id),eq(jobs.state,'queued'))).run();migrated++
    }
    return migrated
  },{behavior:'immediate'})
}

/** Save a small immutable recipe; no video editing job is created at scheduling time. */
export async function planVideoVersion(ctx: Ctx, ws: string, assetId: string, req: VideoVersionRequest) {
  if(!req.banner && !req.coverVersionId) throw new AppError('invalid_input','Escolha uma capa ou um banner.')
  if(req.banner && (!Number.isFinite(req.banner.startMs) || !Number.isFinite(req.banner.endMs) || req.banner.startMs<0 || req.banner.endMs<=req.banner.startMs)) throw new AppError('invalid_input','Intervalo de banner inválido.')
  if(req.banner) assertPng(req.banner.png)
  const dir=await versionsDir(ctx,ws,assetId),versionId=newId()
  const cover=req.coverVersionId?listVersions(ctx.db,ws,assetId).find(v=>v.id===req.coverVersionId && v.kind==='cover_png'):null
  if(req.coverVersionId && !cover) throw new AppError('not_found','Capa não encontrada para este vídeo.')
  const bannerPath=req.banner?join(dir,`banner-${versionId}.png`):undefined
  if(bannerPath) await writeFile(bannerPath,req.banner!.png)
  insertVersion(ctx.db,{id:versionId,workspaceId:ws,assetId,kind:'banner',filePath:join(dir,`planned-${versionId}.mp4`),paramsJson:JSON.stringify({pending:true,bannerPath,coverPath:cover?.filePath,startMs:req.banner?.startMs,endMs:req.banner?.endMs,processingVersion:1}),createdAt:ctx.clock().toISOString()})
  return {versionId}
}
const derivations=new Map<string,Promise<string>>()
async function fileHash(file: string) {
  const started=performance.now();let bytes=0
  const hash=createHash('sha256')
  for await (const chunk of createReadStream(file)) {hash.update(chunk);bytes+=chunk.length}
  if(process.env.LEGACY_PERF_DEBUG==='1') recordDiagnostic({source:'media',level:'DEBUG',message:'Cache: hash/read',duration:performance.now()-started,metadata:{operation:'hash/read',file,bytes}})
  return hash.digest('hex')
}
export function processedCacheDir(ctx: Pick<Ctx,'dataRoot'>, ws: string) {return resolveInside(workspaceDir(ctx.dataRoot,ws),'cache','processed')}
export async function sweepProcessedCache(ctx: Pick<Ctx,'dataRoot' | 'db'>, ws: string) {
  const dir=processedCacheDir(ctx,ws)
  const pinned = new Set(ctx.db.select({ result: jobs.resultJson }).from(jobs).where(and(eq(jobs.workspaceId, ws), eq(jobs.type, 'publish_instagram'), sql`${jobs.state} in ('queued','running','failed')`)).all().flatMap(row => {
    const path = JSON.parse(row.result ?? '{}').processedCachePath
    return typeof path === 'string' ? [path, `${path}.json`] : []
  }))
  const files=await readdir(dir).catch(()=>[])
  for(const name of files) {
    const file=resolveInside(dir,name),info=await stat(file).catch(()=>null)
    if(info && !pinned.has(file) && (name.includes('.partial.') || Date.now()-info.mtimeMs>pipelineConfig.cacheTtlMs)) await rm(file,{force:true})
  }
}
export async function materializeVersion(ctx: Ctx, ws: string, assetId: string, versionId: string): Promise<string> {
  const version=listVersions(ctx.db,ws,assetId).find(v=>v.id===versionId && v.kind==='banner')
  if(!version) throw new AppError('not_found','Versão não encontrada neste workspace.')
  const params=JSON.parse(version.paramsJson)
  if(!params.pending) return version.filePath
  const asset=getAsset(ctx.db,ws,assetId)!
  const visual = params.containerVisual ? frozenRecipeVisual(ctx, ws, params) : null
  const source = visual?.sourcePath ?? asset.filePath
  if (visual && !visual.layout && !visual.watermark && !visual.banner && !visual.cover) return source
  const bannerPath = visual?.banner?.path ?? params.bannerPath
  const coverPath = visual?.cover?.path ?? params.coverPath
  const hashes=await Promise.all([fileHash(source),bannerPath?fileHash(bannerPath):null,coverPath?fileHash(coverPath):null])
  // Only real imported hashes are comparable; legacy/fixture rows without a SHA-256 skip this check.
  if(visual && source===asset.filePath && /^[0-9a-f]{64}$/.test(params.sourceSha256 ?? '') && hashes[0]!==params.sourceSha256) throw new AppError('invalid_media','O arquivo original mudou desde o agendamento. Reimporte o vídeo e reagende.')
  const key=createHash('sha256').update(JSON.stringify(visual ? { hashes, visual, processingVersion: 2, ...(visual.layout ? { rendererVersion: RENDERER_VERSION } : {}) } : {hashes,startMs:params.startMs,endMs:params.endMs,processingVersion:1})).digest('hex')
  const existing=derivations.get(`${ws}:${key}`);if(existing)return existing
  const work=(async()=>{
    const dir=processedCacheDir(ctx,ws);await mkdir(dir,{recursive:true});const out=join(dir,`${key}.mp4`),manifest=`${out}.json`
    try {
      const saved=JSON.parse(await readFile(manifest,'utf8'))
      if(saved.sha256===await fileHash(out)) {const started=performance.now();await probe(out,true);if(process.env.LEGACY_PERF_DEBUG==='1')recordDiagnostic({source:'media',level:'DEBUG',message:'Cache hit',duration:performance.now()-started,metadata:{operation:'cache hit/probe',file:out}});await utimes(out,new Date(),new Date());await utimes(manifest,new Date(),new Date());return out}
    } catch { /* absent or corrupted cache: rebuild from immutable original */ }
    if(process.env.LEGACY_PERF_DEBUG==='1')recordDiagnostic({source:'media',level:'DEBUG',message:'Cache miss',metadata:{operation:'cache miss',file:out}})
    const temp=join(dir,`${key}.${randomUUID()}.partial.mp4`)
    const imageFiles: string[] = []
    const imageFile = async (data: string | undefined, path: string | undefined, role: string) => {
      if (!data) return path
      pngDimensions(data)
      const file = join(dir, `${key}.${randomUUID()}.${role}.partial.png`)
      imageFiles.push(file); await writeFile(file, Buffer.from(data.slice(22), 'base64')); return file
    }
    try {
      const banner = await imageFile(visual?.banner?.imageData, bannerPath, 'banner')
      let cover = await imageFile(visual?.cover?.imageData, coverPath, 'cover')
      if(!cover && visual?.coverFrameMs!==undefined){cover=join(dir,`${key}.${randomUUID()}.cover-frame.partial.png`);imageFiles.push(cover);await extractFrame(source,visual.coverFrameMs,cover)}
      const watermark = await imageFile(visual?.watermark?.imageData ?? undefined, undefined, 'watermark')
      let compositionSource=source
      if(banner || cover || watermark){
        const prepared=visual?.layout?join(dir,`${key}.${randomUUID()}.source.partial.mp4`):temp
        if(visual?.layout)imageFiles.push(prepared)
        await renderVideoVersion(source,prepared,{banner:banner ? {png:banner,window:{startMs:visual?.banner?.startMs ?? params.startMs,endMs:visual?.banner?.endMs ?? params.endMs},firstFrame:visual?.banner?.firstFrame} : undefined,coverPng:cover,
          watermark: watermark && visual?.watermark ? { png: watermark, ...pngDimensions(visual.watermark.imageData!), spec: visual.watermark } : undefined});compositionSource=prepared
      }
      if(visual?.layout){
        if(!ctx.renderVisual)throw new AppError('invalid_input','Renderizador de Templates indisponível.')
        const raster=await ctx.renderVisual(visual.layout)
        // These trusted renderer rasters can exceed the imported-image budget, but still validate PNG and dimensions.
        const rasterFile=async(data:string,role:string)=>{const bytes=Buffer.from(data.slice(22),'base64');assertPng(bytes);const file=join(dir,`${key}.${randomUUID()}.${role}.partial.png`);imageFiles.push(file);await writeFile(file,bytes);return file}
        const background=await rasterFile(raster.background,'background'),mask=raster.mask?await rasterFile(raster.mask,'mask'):undefined,mediaBorder=raster.mediaBorder?await rasterFile(raster.mediaBorder,'border'):undefined
        const layers=[];for(const layer of raster.layers)layers.push({id:layer.id,path:await rasterFile(layer.png,'layer')})
        await renderComposition(compositionSource,temp,visual.layout,{background,mask,mediaBorder,layers})
      }
      await probe(temp,true)
      const sha256=await fileHash(temp)
      await rename(temp,out);await writeFile(manifest,JSON.stringify({sha256,processingVersion:visual ? 2 : 1}))
      return out
    } finally {await rm(temp,{force:true}); await Promise.all(imageFiles.map(path => rm(path,{force:true})))}
  })()
  derivations.set(`${ws}:${key}`,work)
  try{return await work}finally{derivations.delete(`${ws}:${key}`)}
}

/** Enfileira a versão editada (banner e/ou capa como primeiro frame). O id da versão sai antes do job terminar. */
export async function requestVideoVersion(ctx: Ctx, ws: string, assetId: string, req: VideoVersionRequest): Promise<{ versionId: string; job: JobView }> {
  if (!req.banner && !req.coverVersionId) throw new AppError('invalid_input', 'Escolha uma capa ou um banner.')
  if (req.banner && (req.banner.startMs < 0 || req.banner.endMs <= req.banner.startMs)) throw new AppError('invalid_input', 'O fim do banner precisa ser depois do início.')
  if (req.banner) assertPng(req.banner.png)
  const dir = await versionsDir(ctx, ws, assetId)
  let coverPath: string | undefined
  if (req.coverVersionId) {
    const cover = listVersions(ctx.db, ws, assetId).find((v) => v.id === req.coverVersionId && v.kind === 'cover_png')
    if (!cover) throw new AppError('not_found', 'Capa não encontrada para este vídeo.')
    coverPath = cover.filePath
  }
  const versionId = newId()
  let bannerPath: string | undefined
  if (req.banner) {
    bannerPath = join(dir, `banner-${versionId}.png`)
    await writeFile(bannerPath, req.banner.png)
  }
  const job = enqueue(ctx.db, {
    workspaceId: ws, type: 'apply_banner', label: coverPath ? 'Inserir capa no vídeo' : 'Aplicar banner no vídeo',
    payload: { assetId, versionId, bannerPath, startMs: req.banner?.startMs, endMs: req.banner?.endMs, coverPath },
    idempotencyKey: `banner:${versionId}`
  }, ctx.clock())
  return { versionId, job }
}

export async function requestBanner(ctx: Ctx, ws: string, assetId: string, png: Uint8Array, window: { startMs: number; endMs: number }): Promise<JobView> {
  return (await requestVideoVersion(ctx, ws, assetId, { banner: { png, ...window } })).job
}

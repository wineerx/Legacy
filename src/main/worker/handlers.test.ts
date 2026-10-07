import { AppError } from '@shared/errors'
import * as instagram from '../services/instagram-publishing'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { memDb } from '../test-utils'
import { createWorkspace } from '../repos/workspaces'
import { importFiles } from '../services/library'
import { getAsset } from '../repos/assets'
import { makeTestVideo } from '../media/test-fixtures'
import { leaseNext, enqueue, listJobs } from '../queue/queue'
import { listNotifications } from '../repos/notifications'
import { publicationUntilTerminal, processNext, maybeRecover, type WorkerEvent } from './handlers'
import type { Ctx } from '../context'

const src = mkdtempSync(join(tmpdir(), 'legacy-w-'))
const video = join(src, 'v.mp4')
let ctx: Ctx
let ws: string
let events: WorkerEvent[]

beforeAll(async () => { await makeTestVideo(video) })
beforeEach(() => {
  ctx = { db: memDb(), dataRoot: mkdtempSync(join(tmpdir(), 'legacy-wd-')), clock: () => new Date() }
  ws = createWorkspace(ctx.db, { name: 'A', timeZone: 'UTC' }).id
  events = []
})

describe('processNext', () => {
  it('fila vazia devolve false', async () => {
    expect(await processNext(ctx, (e) => events.push(e))).toBe(false)
  })

  it('make_thumbnail grava miniatura e emite eventos', async () => {
    const [r] = await importFiles(ctx, ws, [video])
    expect(await processNext(ctx, (e) => events.push(e))).toBe(true)
    const a = getAsset(ctx.db, ws, r.assetId!)!
    expect(a.thumbnailPath && existsSync(a.thumbnailPath)).toBe(true)
    expect(events.map((e) => e.state)).toEqual(['running', 'done'])
  })

  it('erro permanente falha na hora e cria notificação de erro', async () => {
    enqueue(ctx.db, { workspaceId: ws, type: 'make_thumbnail', payload: { assetId: 'nao-existe' }, label: 'x' }, ctx.clock())
    await processNext(ctx, (e) => events.push(e))
    expect(listJobs(ctx.db, ws)[0].state).toBe('failed')
    expect(events.at(-1)?.state).toBe('failed')
    expect(listNotifications(ctx.db, ws, new Date())[0]).toMatchObject({ kind: 'error' })
  })
})

describe('processNext falhas', () => {
  it('falha transitória volta para a fila com evento retry e sem notificação', async () => {
    // payload nulo provoca TypeError (não-AppError): falha transitória
    enqueue(ctx.db, { workspaceId: ws, type: 'make_thumbnail', payload: null, label: 'y' }, ctx.clock())
    events = []
    await processNext(ctx, (e) => events.push(e))
    expect(events.map((e) => e.state)).toEqual(['running', 'retry'])
    expect(listJobs(ctx.db, ws)[0].state).toBe('queued')
    expect(listNotifications(ctx.db, ws, new Date())).toHaveLength(0)
  })

  it('tipo desconhecido falha de forma permanente', async () => {
    enqueue(ctx.db, { workspaceId: ws, type: 'tipo_x' as never, payload: {}, label: 'z' }, ctx.clock())
    await processNext(ctx, (e) => events.push(e))
    expect(listJobs(ctx.db, ws)[0].state).toBe('failed')
    expect(events.at(-1)?.state).toBe('failed')
  })
})

describe('maybeRecover', () => {
  it('recupera leases expirados só depois do intervalo', () => {
    const t0 = Date.parse('2026-10-05T12:00:00Z')
    enqueue(ctx.db, { workspaceId: ws, type: 'make_thumbnail', payload: {}, label: 'x' }, new Date(t0))
    leaseNext(ctx.db, new Date(t0), 1000)
    expect(maybeRecover(ctx, t0, t0 + 5000, 15_000)).toBe(t0)
    expect(listJobs(ctx.db, ws)[0].state).toBe('running')
    expect(maybeRecover(ctx, t0, t0 + 20_000, 15_000)).toBe(t0 + 20_000)
    expect(listJobs(ctx.db, ws)[0].state).toBe('queued')
  })
})

it('publicação permanece running nas consultas intermediárias e completa uma única vez', async () => {
  const spy = vi.spyOn(instagram, 'publishInstagram')
  spy.mockImplementationOnce(async () => { expect(listJobs(ctx.db, ws)[0].state).toBe('running'); throw new instagram.InstagramPending(1) })
    .mockImplementationOnce(async () => { expect(listJobs(ctx.db, ws)[0].state).toBe('running'); throw new instagram.InstagramPending(1) })
    .mockResolvedValueOnce({ confirmedPublished: true } as never)
  enqueue(ctx.db, { workspaceId: ws, type: 'publish_instagram', payload: {}, label: 'Publicar' }, ctx.clock())
  try {
    await processNext(ctx, e => events.push(e))
    expect(events.map(e => e.state)).toEqual(['running', 'done'])
    expect(listJobs(ctx.db, ws)[0]).toMatchObject({ state: 'done', attempts: 1 })
    expect(spy).toHaveBeenCalledTimes(3)
  } finally { spy.mockRestore() }
})


it('resposta incompleta continua em execução até confirmação, sem inferir sucesso', async () => {
 const run=vi.fn().mockRejectedValueOnce(new Error('Resposta incompleta')).mockResolvedValueOnce({confirmedPublished:true})
 const wait=vi.fn(async()=>{})
 await expect(publicationUntilTerminal(run,wait)).resolves.toEqual({confirmedPublished:true})
 expect(wait).toHaveBeenCalledWith(15000)
 expect(run).toHaveBeenCalledTimes(2)
})

it('erro explícito na preparação de publicação termina failed sem retornar à fila', async () => {
 const spy=vi.spyOn(instagram,'publishInstagram').mockRejectedValueOnce(new AppError('ffmpeg_failed','Falha explícita no encoder'))
 enqueue(ctx.db,{workspaceId:ws,type:'publish_instagram',payload:{},label:'Publicar'},ctx.clock())
 try {
  await processNext(ctx,e=>events.push(e))
  expect(events.map(e=>e.state)).toEqual(['running','failed'])
  expect(listJobs(ctx.db,ws)[0].state).toBe('failed')
 } finally {spy.mockRestore()}
})

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import type { Channel, IpcResult } from '@shared/ipc-contract'

/**
 * Channels the local MCP server may call. Credentials, deletion, storage and settings stay in the
 * window only. Every call still goes through the same dispatcher, so zod validation and workspace
 * scope are identical to the renderer's.
 */
export const MCP_BRIDGE_CHANNELS = [
  'app.bootstrap', 'session.get', 'dashboard.get', 'jobs.health', 'jobs.query', 'jobs.details', 'notifications.list',
  'accounts.instagramList', 'quota.get', 'grid.query', 'library.details', 'library.pending', 'library.importPaths',
  'audio.importPath', 'audio.list', 'publications.history', 'publications.checkRepost',
  'containers.create', 'containers.updateDraft', 'containers.get', 'containers.query', 'containers.schedule',
  'containers.pause', 'containers.resume', 'containers.cancel'
] as const satisfies readonly Channel[]
const allowed = new Set<string>(MCP_BRIDGE_CHANNELS)
const ungated = new Set<string>(['app.bootstrap', 'session.get'])
const MAX_BODY = 1024 * 1024

export interface BridgeInfo { port: number; token: string; pid: number; version: string }
export interface McpBridgeOptions {
  dispatch(channel: string, input: unknown): Promise<IpcResult<unknown>>
  /** Same gate as the window: the worker only runs after the guest session is entered. */
  entered(): boolean
  infoPath: string
  version: string
}

const fail = (message: string): IpcResult<never> => ({ ok: false, error: { code: 'invalid_input', message } })
function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Loopback-only HTTP bridge. The token lives in a file under the user's data folder; browsers are refused by Origin and Host. */
export async function startMcpBridge(opts: McpBridgeOptions): Promise<{ port: number; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const authorized = (header: string | undefined) => {
    const got = Buffer.from(header ?? '')
    return got.length === expected.length && timingSafeEqual(got, expected)
  }
  let port = 0
  const server = createServer(async (req, res) => {
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}`) return reply(res, 403, fail('Origem não permitida.'))
    if (!authorized(req.headers.authorization)) return reply(res, 401, fail('Token inválido.'))
    if (req.method !== 'POST' || req.url !== '/invoke') return reply(res, 404, fail('Rota não encontrada.'))
    let body: { channel?: unknown; input?: unknown }
    try { body = JSON.parse(await readBody(req)) } catch { return reply(res, 400, fail('Requisição inválida.')) }
    const channel = typeof body.channel === 'string' ? body.channel : ''
    if (!allowed.has(channel)) return reply(res, 403, fail(`Canal não disponível para o MCP: ${channel || 'vazio'}`))
    if (!ungated.has(channel) && !opts.entered()) return reply(res, 409, fail('Abra o Legacy e entre como visitante para continuar.'))
    reply(res, 200, await opts.dispatch(channel, body.input ?? {}))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  port = (server.address() as AddressInfo).port
  const info: BridgeInfo = { port, token, pid: process.pid, version: opts.version }
  await writeFile(opts.infoPath, JSON.stringify(info), { mode: 0o600 })
  return {
    port,
    async close() {
      await rm(opts.infoPath, { force: true })
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

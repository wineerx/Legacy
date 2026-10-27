import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startMcpBridge, type BridgeInfo } from './mcp-bridge'

let dir: string, entered: boolean, bridge: Awaited<ReturnType<typeof startMcpBridge>>, info: BridgeInfo
const dispatch = vi.fn(async (channel: string, input: unknown) => ({ ok: true as const, data: { channel, input } }))

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-mcp-bridge-')); entered = true; dispatch.mockClear()
  bridge = await startMcpBridge({ dispatch, entered: () => entered, infoPath: join(dir, 'mcp-bridge.json'), version: '0.0.0-test' })
  info = JSON.parse(readFileSync(join(dir, 'mcp-bridge.json'), 'utf8'))
})
afterEach(async () => { await bridge.close(); rmSync(dir, { recursive: true, force: true }) })

function call(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: info.port, method: 'POST', path: '/invoke', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json', ...headers } }, res => {
      let text = ''; res.on('data', c => { text += c }); res.on('end', () => resolve({ status: res.statusCode!, json: JSON.parse(text) }))
    })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
}

it('writes the connection file and forwards allowlisted channels to the dispatcher', async () => {
  expect(info).toMatchObject({ port: bridge.port, version: '0.0.0-test' })
  expect(info.token).toMatch(/^[0-9a-f]{64}$/)
  const res = await call({ channel: 'containers.query', input: { workspaceId: 'w' } })
  expect(res).toEqual({ status: 200, json: { ok: true, data: { channel: 'containers.query', input: { workspaceId: 'w' } } } })
})
it('refuses a wrong token, a browser origin and channels outside the allowlist', async () => {
  expect((await call({ channel: 'app.bootstrap' }, { authorization: 'Bearer nope' })).status).toBe(401)
  expect((await call({ channel: 'app.bootstrap' }, { origin: 'https://example.com' })).status).toBe(403)
  for (const channel of ['accounts.connectInstagram', 'library.deleteMany', 'integrations.saveApify', 'toString']) {
    const res = await call({ channel, input: {} })
    expect(res.status).toBe(403)
  }
  expect(dispatch).not.toHaveBeenCalled()
})
it('keeps the guest-session gate except for bootstrap', async () => {
  entered = false
  expect((await call({ channel: 'containers.schedule', input: {} })).json.error.message).toMatch(/entre como visitante/)
  expect((await call({ channel: 'app.bootstrap' })).status).toBe(200)
  expect(dispatch).toHaveBeenCalledTimes(1)
})
it('removes the connection file on close', async () => {
  await bridge.close()
  expect(existsSync(join(dir, 'mcp-bridge.json'))).toBe(false)
  bridge = await startMcpBridge({ dispatch, entered: () => true, infoPath: join(dir, 'mcp-bridge.json'), version: 'x' })
})

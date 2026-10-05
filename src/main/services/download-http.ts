import { resolve4 } from 'node:dns/promises'
import { request } from 'node:https'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AppError } from '@shared/errors'

export function allowedUrl(input: string, api = false): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new AppError('invalid_input', 'URL de download inválida.') }
  const h = url.hostname
  const allowed = api ? h === 'api.apify.com' : ['cdninstagram.com', 'fbcdn.net'].some((d) => h.endsWith(`.${d}`))
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
    throw new AppError('forbidden', 'Host de download não permitido.')
  }
  return url
}

export function publicIpv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return false
  const [a, b, c] = p
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
}

async function response(input: string, api: boolean, signal: AbortSignal, body?: string, token?: string, redirects = 0): Promise<import('node:http').IncomingMessage> {
  const url = allowedUrl(input, api)
  const addresses = await resolve4(url.hostname)
  if (!addresses.length || addresses.some((ip) => !publicIpv4(ip))) throw new AppError('forbidden', 'Endereço de rede não permitido.')
  signal.throwIfAborted()
  const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      method: body ? 'POST' : 'GET', signal,
      // Pin the validated DNS answer to this connection, retaining TLS hostname validation.
      lookup: (_host, _options, cb) => cb(null, addresses[0], 4), family: 4,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }
    }, resolve)
    req.on('error', reject)
    req.end(body)
  })
  if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
    res.destroy()
    if (api || redirects >= 3 || !res.headers.location) throw new AppError('forbidden', 'Redirecionamento não permitido.')
    return response(new URL(res.headers.location, url).href, false, signal, undefined, undefined, redirects + 1)
  }
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    res.destroy()
    const status = res.statusCode
    throw new AppError(status === 401 || status === 403 ? 'forbidden' : 'internal',
      api ? `Apify respondeu HTTP ${status}. Verifique token, saldo e disponibilidade do serviço.` : `Download respondeu HTTP ${status}. Busque o perfil novamente se o link expirou.`)
  }
  return res
}

export async function apifyJson(path: string, token: string, body?: unknown): Promise<unknown> {
  try {
    const res = await response(`https://api.apify.com/v2/${path}`, true, AbortSignal.timeout(90_000), body === undefined ? undefined : JSON.stringify(body), token)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of res) {
      size += chunk.length
      if (size > 10 * 1024 * 1024) { res.destroy(); throw new AppError('invalid_input', 'Resposta do provedor acima de 10 MB.') }
      chunks.push(Buffer.from(chunk))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('internal', 'Não foi possível consultar a Apify. Verifique a conexão e tente novamente.')
  }
}

export async function downloadVideo(url: string, target: string): Promise<void> {
  try {
    const signal = AbortSignal.timeout(5 * 60_000)
    const res = await response(url, false, signal)
    const max = 1024 ** 3
    if (Number(res.headers['content-length']) > max) { res.destroy(); throw new AppError('invalid_media', 'Vídeo acima de 1 GB.') }
    let size = 0
    const limit = new Transform({ transform(chunk, _encoding, cb) {
      size += chunk.length
      cb(size > max ? new AppError('invalid_media', 'Vídeo acima de 1 GB.') : null, chunk)
    } })
    await pipeline(res, limit, createWriteStream(target, { flags: 'wx' }), { signal })
  } catch (e) {
    await rm(target, { force: true })
    if (e instanceof AppError) throw e
    throw new AppError('internal', 'Download interrompido. Verifique a conexão e o espaço em disco.')
  }
}

import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { pipeline } from 'node:stream'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { AppError } from '@shared/errors'

export interface FileShare { port: number; urlPath: string; close(): Promise<void> }

// Loopback only; the single file is reachable just through an unguessable path.
export async function shareFile(filePath: string): Promise<FileShare> {
  const size = statSync(filePath).size
  if (size === 0) throw new AppError('invalid_media', 'O vídeo preparado está vazio.')
  const urlPath = `/${randomBytes(32).toString('base64url')}/video.mp4`
  const server = createServer((req, res) => {
    if ((req.url ?? '').split('?')[0] !== urlPath || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404).end(); return }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    const partial = Boolean(range && (range[1] || range[2]))
    let start = 0; let end = size - 1
    if (range && partial) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return }
    }
    res.writeHead(partial ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
    if (req.method === 'HEAD') { res.end(); return }
    pipeline(createReadStream(filePath, { start, end }), res, () => {})
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  return {
    port: (server.address() as AddressInfo).port,
    urlPath,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) })
  }
}

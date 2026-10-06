import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

// Versão fixada; nunca usar "latest". Licença Apache 2.0.
const VERSION = '2026.9.3'
const BASE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`
// Pinned: bumping the version means updating this hash in the same commit.
const EXPECTED_SHA256 = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2'
const outDir = join('resources', 'bin', 'win32-x64')
const target = join(outDir, 'cloudflared.exe')

if (existsSync(target)) { console.log('cloudflared já presente em', outDir); process.exit(0) }
mkdirSync(outDir, { recursive: true })
const partial = `${target}.download`
const res = await fetch(`${BASE}/cloudflared-windows-amd64.exe`)
if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(partial))
const sha = createHash('sha256').update(readFileSync(partial)).digest('hex')
if (sha !== EXPECTED_SHA256) { rmSync(partial, { force: true }); throw new Error(`sha256 não confere: esperado ${EXPECTED_SHA256}, obtido ${sha}`) }
renameSync(partial, target)
const license = await fetch(`https://raw.githubusercontent.com/cloudflare/cloudflared/${VERSION}/LICENSE`)
if (license.ok) writeFileSync(join(outDir, 'CLOUDFLARED-LICENSE.txt'), await license.text())
console.log('cloudflared', VERSION, 'instalado em', outDir)

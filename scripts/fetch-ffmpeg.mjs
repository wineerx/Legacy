import { createWriteStream, existsSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

// Build fixada (BtbN autobuild versionado, LGPL, win64). Nunca usar a tag móvel "latest".
const RELEASE = 'autobuild-2026-10-03-18-14'
const NAME = 'ffmpeg-n8.1.3-14-g330caae0c1-win64-lgpl-8.1'
const URL_ZIP = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE}/${NAME}.zip`
const EXPECTED_SHA256 = process.env.FFMPEG_SHA256 || '32311af342f7dcfaee91e34eef3a1e3b71ee27ee4129e8d37a26402a16d4504b'
const outDir = join('resources', 'bin', 'win32-x64')

if (existsSync(join(outDir, 'ffmpeg.exe')) && existsSync(join(outDir, 'ffprobe.exe'))) {
  console.log('FFmpeg já presente em', outDir)
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })
const work = join(tmpdir(), `legacy-ffmpeg-${Date.now()}`)
mkdirSync(work, { recursive: true })
const zip = join(work, `${NAME}.zip`)
console.log('Baixando', URL_ZIP)
const res = await fetch(URL_ZIP)
if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip))
const sha = createHash('sha256').update(readFileSync(zip)).digest('hex')
console.log('sha256', sha)
if (sha !== EXPECTED_SHA256.toLowerCase()) {
  rmSync(work, { recursive: true, force: true })
  throw new Error(`sha256 não confere: esperado ${EXPECTED_SHA256}, obtido ${sha}`)
}
// bsdtar do Windows: o tar GNU do Git Bash trata "C:" como host remoto
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
execFileSync(tar, ['-xf', zip, '-C', work], { stdio: 'inherit' })
for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) copyFileSync(join(work, NAME, 'bin', exe), join(outDir, exe))
copyFileSync(join(work, NAME, 'LICENSE.txt'), join(outDir, 'FFMPEG-LICENSE.txt'))
rmSync(work, { recursive: true, force: true })
console.log('FFmpeg LGPL instalado em', outDir)

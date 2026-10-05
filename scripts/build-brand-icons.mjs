// Rasterize our vector mark; create Windows icons without a runtime image dependency.
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
const svg = await readFile(new URL('../resources/mascot.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ headless: true, channel: process.env.LEGACY_ICON_BROWSER ?? 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`)
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size })
    const png = await page.screenshot({ omitBackground: true })
    images.push(png)
    if (size === 32) await writeFile(new URL('../resources/tray.png', import.meta.url), png)
    if (size === 256) await writeFile(new URL('../resources/icon.png', import.meta.url), png)
  }
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((png, index) => {
    const at = 6 + index * 16
    header[at] = sizes[index] % 256; header[at + 1] = sizes[index] % 256
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  await writeFile(new URL('../resources/icon.ico', import.meta.url), Buffer.concat([header, ...images]))
  console.log('Legacy: transparent PNGs and seven-size Windows ICO generated.')
} finally { await browser.close() }

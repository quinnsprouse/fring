// What fring costs in Chromium, from the browser's own trace.
//
// Presses Tab 150 times on a 13,000-element page, with and without fring, and
// adds up where the time went: script, style, layout, and the paint and raster
// work that script timers cannot see. Tracing slows everything down, so read
// the two columns against each other, not as absolute times.
import { readFileSync, rmSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

let server = null
try {
  server = await createServer({ configFile: 'tests/fixture/vite.config.ts' })
  await server.listen()
} catch {
  server = null
}

const NAMES = ['FunctionCall', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'RasterTask', 'GPUTask']

async function run(enabled) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await page.goto('http://localhost:5199/perf.html')
  await page.waitForFunction(() => window.ready)
  if (enabled) await page.evaluate(() => window.fring())
  await page.keyboard.press('Tab')
  await page.waitForTimeout(500)

  const path = `test-results/trace-${enabled ? 'on' : 'off'}.json`
  await browser.startTracing(page, {
    path,
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'gpu'],
  })
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(500)
  await browser.stopTracing()
  await browser.close()

  const events = JSON.parse(readFileSync(path, 'utf8')).traceEvents
  rmSync(path)
  const totals = Object.fromEntries(NAMES.map((name) => [name, { ms: 0, count: 0 }]))
  for (const event of events) {
    if (event.ph !== 'X' || !totals[event.name]) continue
    totals[event.name].ms += (event.dur ?? 0) / 1000
    totals[event.name].count++
  }
  return totals
}

const off = await run(false)
const on = await run(true)
console.log(''.padEnd(18), 'without'.padStart(16), 'with fring'.padStart(16), 'added'.padStart(10))
let added = 0
for (const name of NAMES) {
  const a = off[name]
  const b = on[name]
  added += b.ms - a.ms
  console.log(
    name.padEnd(18),
    `${a.ms.toFixed(1)} ms /${String(a.count).padStart(5)}`.padStart(16),
    `${b.ms.toFixed(1)} ms /${String(b.count).padStart(5)}`.padStart(16),
    `${(b.ms - a.ms).toFixed(1)} ms`.padStart(10),
  )
}
console.log(`\nadded by fring: ${added.toFixed(1)} ms over 150 focus changes, ${(added / 150).toFixed(3)} ms each`)
await server?.close()

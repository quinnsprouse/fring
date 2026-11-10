// Times fring's own work, one piece at a time, on a 13,000-element page.
//
// Frames are driven by hand, so each number is the script, style and layout
// that one step causes and nothing else. Run with an engine name to compare:
//   node scripts/bench.mjs chromium|firefox|webkit
import { chromium, firefox, webkit } from '@playwright/test'
import { createServer } from 'vite'

const engine = process.argv[2] ?? 'chromium'

let server = null
try {
  server = await createServer({ configFile: 'tests/fixture/vite.config.ts' })
  await server.listen()
} catch {
  server = null
}

const browser = await { chromium, firefox, webkit }[engine].launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.addInitScript(() => {
  let queue = []
  let time = 0
  let ids = 0
  window.requestAnimationFrame = (cb) => (queue.push({ id: ++ids, cb }), ids)
  window.cancelAnimationFrame = (id) => (queue = queue.filter((e) => e.id !== id))
  // fring wakes itself with a ResizeObserver. Report to it on the next frame.
  const observers = []
  window.ResizeObserver = class {
    constructor(cb) {
      this.me = { cb, el: null, seen: undefined }
      observers.push(this.me)
    }
    observe(el) {
      this.me.el = el
      this.me.seen = undefined
    }
    unobserve() {
      this.me.el = null
    }
    disconnect() {
      this.me.el = null
    }
  }
  window.__frame = (ms = 1000 / 60) => {
    time += ms
    const run = queue
    queue = []
    for (const e of run) e.cb(time)
    for (const o of observers) {
      if (!o.el?.isConnected || o.el.style.width === o.seen) continue
      o.seen = o.el.style.width
      o.cb([], o)
    }
  }
  window.__queued = () => queue.length
})
await page.goto('http://localhost:5199/perf.html')
await page.waitForFunction(() => window.ready)

const result = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')]
  const settle = () => {
    for (let i = 0; i < 400 && window.__queued(); i++) window.__frame()
  }
  // A real focus change, measured in three parts.
  const run = (rounds) => {
    let focus = 0
    let takeoff = 0
    let frames = 0
    let frameCount = 0
    let landing = 0
    for (let r = 0; r < rounds; r++) {
      const el = buttons[(r * 7) % buttons.length]
      let t = performance.now()
      el.focus({ preventScroll: true })
      focus += performance.now() - t

      t = performance.now()
      window.__frame()
      takeoff += performance.now() - t

      // Mid-flight frames.
      for (let i = 0; i < 8 && window.__queued(); i++) {
        t = performance.now()
        window.__frame()
        frames += performance.now() - t
        frameCount++
      }
      t = performance.now()
      settle()
      landing += performance.now() - t
    }
    return { focus, takeoff, frames, frameCount, landing }
  }

  buttons[0].focus()
  settle()
  const off = run(600)

  const stop = window.fring()
  buttons[0].focus()
  settle()
  run(200) // warm up
  const on = run(600)

  // Holding Tab: a new target every two frames, so flights never land.
  buttons[0].focus()
  settle()
  let held = 0
  const hops = 600
  for (let r = 0; r < hops; r++) {
    const t = performance.now()
    buttons[(r * 3) % buttons.length].focus({ preventScroll: true })
    window.__frame()
    window.__frame()
    held += performance.now() - t
  }
  settle()
  stop()

  buttons[0].focus()
  let heldOff = 0
  for (let r = 0; r < hops; r++) {
    const t = performance.now()
    buttons[(r * 3) % buttons.length].focus({ preventScroll: true })
    window.__frame()
    window.__frame()
    heldOff += performance.now() - t
  }

  const us = (ms, n) => Math.round((ms / n) * 1000 * 10) / 10
  return {
    'focus() call, without fring (µs)': us(off.focus, 600),
    'focus() call, with fring (µs)': us(on.focus, 600),
    'takeoff frame (µs)': us(on.takeoff, 600),
    'each flight frame (µs)': us(on.frames, on.frameCount),
    'whole flight, focus to landed (µs)': us(on.focus + on.takeoff + on.frames + on.landing, 600),
    'held Tab, per hop, without fring (µs)': us(heldOff, hops),
    'held Tab, per hop, with fring (µs)': us(held, hops),
  }
})
console.log(engine)
for (const [name, value] of Object.entries(result)) console.log(' ', name.padEnd(40), String(value).padStart(8))

await browser.close()
await server?.close()

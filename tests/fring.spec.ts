import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * Frames are driven by hand. requestAnimationFrame is replaced with a queue
 * that only runs when a test asks for a frame, so every assertion is about a
 * known frame rather than "some time later".
 */
declare global {
  interface Window {
    __frame: (ms?: number) => void
    /** Frames fring has asked for and not yet been given. */
    __queued: () => number
    stop: () => void
  }
}

interface Ghost {
  /** Something is being drawn. */
  flying: boolean
  /** How this frame is drawn: one painted box, or four composited quarters. */
  mode: 'none' | 'painted' | 'composed'
  inTopLayer: boolean
  x: number
  y: number
  width: number
  height: number
  opacity: number
  radius: string
  outline: string
  shadow: string
  clip: string
}

const errors = new WeakMap<Page, string[]>()

async function open(page: Page, options: Record<string, unknown> = {}, path = '/') {
  const seen: string[] = []
  errors.set(page, seen)
  page.on('pageerror', (error) => seen.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push(message.text())
  })
  await page.addInitScript(() => {
    let queue: { id: number; callback: FrameRequestCallback }[] = []
    let time = 0
    let ids = 0
    window.requestAnimationFrame = (callback) => {
      queue.push({ id: ++ids, callback })
      return ids
    }
    window.cancelAnimationFrame = (id) => {
      queue = queue.filter((entry) => entry.id !== id)
    }
    // The same for ResizeObserver, which is how fring wakes itself up: a fake
    // one that reports on the next frame run by hand, after that frame's
    // callbacks, the way a real one reports after layout.
    const observers: { callback: ResizeObserverCallback; el: HTMLElement | null; seen?: string }[] = []
    window.ResizeObserver = class {
      me: (typeof observers)[number]
      constructor(callback: ResizeObserverCallback) {
        this.me = { callback, el: null }
        observers.push(this.me)
      }
      observe(el: HTMLElement) {
        this.me.el = el
        this.me.seen = undefined
      }
      unobserve() {
        this.me.el = null
      }
      disconnect() {
        this.me.el = null
      }
    } as unknown as typeof ResizeObserver
    window.__queued = () => queue.length
    window.__frame = (ms = 1000 / 60) => {
      time += ms
      const run = queue
      queue = []
      for (const entry of run) entry.callback(time)
      for (const observer of observers) {
        if (!observer.el?.isConnected || observer.el.style.width === observer.seen) continue
        observer.seen = observer.el.style.width
        observer.callback([], observer as unknown as ResizeObserver)
      }
    }
  })
  await page.goto(`${path}?o=${encodeURIComponent(JSON.stringify(options))}`)
  await page.waitForFunction(() => 'stop' in window)
  await frames(page, 2)
}

test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([])
})

const frames = (page: Page, count = 1, ms?: number) =>
  page.evaluate(
    ([count, ms]) => {
      for (let i = 0; i < count!; i++) window.__frame(ms ?? undefined)
    },
    [count, ms] as const,
  )

const ghost = (page: Page): Promise<Ghost> =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('fring-ghost')
    const root = host?.shadowRoot
    const box = root?.querySelector<HTMLElement>('i')
    const flock = root?.querySelector<HTMLElement>('b')
    const wings = [...(root?.querySelectorAll<HTMLElement>('s') ?? [])]
    const shown = (el?: HTMLElement | null) => !!el && getComputedStyle(el).display !== 'none'
    const mode = shown(box) ? 'painted' : shown(flock) ? 'composed' : 'none'

    // The ring's box: the painted box itself, or the corners the quarters are pinned by.
    let rect = { x: 0, y: 0, width: 0, height: 0 }
    if (mode === 'painted') rect = box!.getBoundingClientRect()
    if (mode === 'composed') {
      const first = wings[0]!.getBoundingClientRect()
      const third = wings[2]!.getBoundingClientRect()
      rect = { x: first.left, y: first.top, width: third.right - first.left, height: third.bottom - first.top }
    }
    const worn = mode === 'composed' ? wings[0]! : box
    const cs = worn && getComputedStyle(worn)
    return {
      flying: mode !== 'none',
      mode,
      inTopLayer: !!host && host.matches(':popover-open'),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: box ? Number(box.style.opacity || 1) : 0,
      radius: cs?.borderTopLeftRadius ?? '',
      outline: cs ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor} ${cs.outlineOffset}` : '',
      shadow: cs?.boxShadow ?? '',
      clip: mode === 'painted' ? getComputedStyle(box!).clipPath : 'none',
    }
  })

/** Finds an element by id, looking inside the one shadow root in the fixture too. */
const find = `(id) => document.getElementById(id) ?? document.getElementById('host').shadowRoot.getElementById(id)`

const focus = (page: Page, id: string) => page.evaluate(`(${find})(${JSON.stringify(id)}).focus()`)

const rect = (page: Page, id: string) =>
  page.evaluate(`(() => { const r = (${find})(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`) as Promise<{
    x: number
    y: number
    width: number
    height: number
  }>

const inlineStyle = (page: Page, id: string) =>
  page.evaluate(`(${find})(${JSON.stringify(id)}).getAttribute('style')`) as Promise<string | null>

const computed = (page: Page, id: string, prop: string) =>
  page.evaluate(`getComputedStyle((${find})(${JSON.stringify(id)}))[${JSON.stringify(prop)}]`) as Promise<string>

const outlineOf = async (page: Page, id: string) =>
  `${await computed(page, id, 'outlineWidth')} ${await computed(page, id, 'outlineStyle')} ${await computed(page, id, 'outlineColor')} ${await computed(page, id, 'outlineOffset')}`

/** Runs frames until the ghost is gone. Returns how many it took. */
async function land(page: Page, limit = 240) {
  for (let i = 1; i <= limit; i++) {
    await frames(page)
    if (!(await ghost(page)).flying) return i
  }
  throw new Error(`still flying after ${limit} frames`)
}

async function focusAndLand(page: Page, id: string) {
  await focus(page, id)
  await frames(page)
  if ((await ghost(page)).flying) await land(page)
}

function differingPixels(a: Buffer, b: Buffer): number {
  const one = PNG.sync.read(a)
  const two = PNG.sync.read(b)
  expect([two.width, two.height]).toEqual([one.width, one.height])
  let count = 0
  for (let i = 0; i < one.data.length; i += 4) {
    const delta =
      Math.abs(one.data[i]! - two.data[i]!) +
      Math.abs(one.data[i + 1]! - two.data[i + 1]!) +
      Math.abs(one.data[i + 2]! - two.data[i + 2]!)
    // Ignore differences no eye can see (a rounding step in one channel).
    if (delta > 12) count++
  }
  return count
}

test('the ring settles in from outside when nothing was focused', async ({ page }) => {
  await open(page)
  await focus(page, 'a')
  await frames(page)

  const first = await ghost(page)
  const a = await rect(page, 'a')
  expect(first.flying).toBe(true)
  expect(first.inTopLayer).toBe(true)
  expect(first.opacity).toBeLessThan(0.5)
  expect(first.x).toBeCloseTo(a.x - 6, 0)
  expect(first.width).toBeCloseTo(a.width + 12, 0)
  expect(first.outline).toBe('2px solid rgb(37, 99, 235) 2px')
  // The element's own ring is held back while the ghost is in the air.
  expect(await computed(page, 'a', 'outlineStyle')).toBe('none')

  await land(page)

  const done = await ghost(page)
  expect(done.flying).toBe(false)
  expect(await inlineStyle(page, 'a')).toBeNull()
  expect(await outlineOf(page, 'a')).toBe('2px solid rgb(37, 99, 235) 2px')
})

test('the ring glides from the old element to the new one', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  const from = await rect(page, 'a')
  const to = await rect(page, 'round')

  await focus(page, 'round')
  await frames(page)
  const start = await ghost(page)
  expect(start.flying).toBe(true)
  expect(start.opacity).toBe(1)
  expect(start.x).toBeCloseTo(from.x, 0)
  expect(start.y).toBeCloseTo(from.y, 0)
  expect(start.radius).toBe('0px')
  expect(await computed(page, 'round', 'outlineStyle')).toBe('none')
  expect(await inlineStyle(page, 'a')).toBeNull()

  // It should only ever move toward the target.
  let previous = start.x
  let last = start
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    // The default bounce overshoots by a fraction of a pixel and comes back.
    expect(now.x).toBeGreaterThanOrEqual(previous - 1)
    expect(now.x).toBeLessThanOrEqual(to.x + 2)
    previous = now.x
    last = now
  }
  expect(last.x).toBeCloseTo(to.x, 0)
  expect(last.width).toBeCloseTo(to.width, 0)
  expect(parseFloat(last.radius)).toBeCloseTo(8, 0)

  expect((await ghost(page)).flying).toBe(false)
  expect(await inlineStyle(page, 'round')).toBeNull()
  expect(await outlineOf(page, 'round')).toBe('2px solid rgb(37, 99, 235) 2px')
})

/**
 * The claim the whole design rests on: the last frame of the ghost and the
 * browser's own ring are the same picture. Screenshot both and count pixels
 * that changed by more than a rounding step. Outlines get a budget of two such
 * pixels (in practice Chromium moves one antialiased pixel on one inset
 * outline, and every other case is zero).
 */
const seams: [from: string, to: string, tolerance?: number][] = [
  ['a', 'round'],
  ['round', 'pill'],
  ['pill', 'blob'],
  ['blob', 'red'],
  ['native1', 'native2'],
  ['bordered1', 'bordered2'],
  ['all1', 'all2'],
  // A box-shadow ring is painted under its element's border and the ghost is
  // painted over it, so the antialiased pixels where the two meet at a rounded
  // corner blend in a different order. A few dozen pixels shift by a shade.
  ['shadow1', 'shadow2', 60],
  // The ghost's clip edge and the browser's own overflow clip can antialias
  // the cut ends of the ring differently.
  ['clip1', 'clip2', 80],
]

for (const [from, to, tolerance = 2] of seams) {
  test(`landing on #${to} from #${from} is seamless`, async ({ page }) => {
    await open(page)
    await focusAndLand(page, from)
    const target = await rect(page, to)
    const clip = {
      x: Math.floor(target.x - 16),
      y: Math.floor(target.y - 16),
      width: Math.ceil(target.width + 32),
      height: Math.ceil(target.height + 32),
    }

    await focus(page, to)
    await frames(page)
    // The ghost blends between ring styles with a CSS transition, which runs
    // on the real clock while these frames run on a fake one. Let it finish.
    await page.waitForTimeout(250)
    let lastFrame: Buffer | null = null
    for (let i = 0; i < 240; i++) {
      await frames(page)
      const now = await ghost(page)
      if (!now.flying) break
      if (Math.abs(now.x - target.x) < 1 && Math.abs(now.width - target.width) < 1) {
        lastFrame = await page.screenshot({ clip })
      }
    }
    expect((await ghost(page)).flying).toBe(false)
    expect(lastFrame).not.toBeNull()

    const landed = await page.screenshot({ clip })
    if (process.env.FRING_DEBUG) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync('test-results/seams', { recursive: true })
      writeFileSync(`test-results/seams/${test.info().project.name}-${to}-ghost.png`, lastFrame!)
      writeFileSync(`test-results/seams/${test.info().project.name}-${to}-landed.png`, landed)
    }
    expect(differingPixels(lastFrame!, landed)).toBeLessThanOrEqual(tolerance)
  })
}

test('a box-shadow ring flies while the elevation shadow stays put', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'shadow1')
  const resting = await computed(page, 'shadow1', 'boxShadow')
  const focused = await computed(page, 'shadow1', 'boxShadow')
  expect(focused).toContain('3px')

  await focus(page, 'shadow2')
  await frames(page, 3)
  const flying = await ghost(page)
  expect(flying.flying).toBe(true)
  expect(flying.shadow).toContain('0px 0px 0px 3px')
  expect(flying.shadow).not.toContain('1px 2px')
  // The destination keeps its elevation and nothing else.
  const held = await computed(page, 'shadow2', 'boxShadow')
  expect(held).toContain('1px 2px')
  expect(held).not.toContain('0px 0px 0px 3px')

  await land(page)
  // Not mid-transition: the full ring is there on the very frame the ghost leaves.
  expect(await computed(page, 'shadow2', 'boxShadow')).toBe(resting)
  expect(await inlineStyle(page, 'shadow2')).toBeNull()
})

test('an outline used as a border stays visible during the flight', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'bordered1')
  const border = await outlineOf(page, 'bordered2')
  expect(border).toContain('1px solid')

  await focus(page, 'bordered2')
  await frames(page, 3)
  expect((await ghost(page)).flying).toBe(true)
  expect(await outlineOf(page, 'bordered2')).toBe(border)
  expect((await ghost(page)).outline).toContain('rgb(79, 70, 229)')

  await land(page)
  expect(await outlineOf(page, 'bordered2')).toBe('2px solid rgb(79, 70, 229) -2px')
})

test("the element's own transitions cannot leak a second ring", async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'all1')
  await focus(page, 'all2')
  await frames(page, 2)
  // transition: all would fade the outline in over 300ms; the ghost must read the end state.
  expect((await ghost(page)).outline).toBe('2px solid rgb(5, 150, 105) 3px')
  await land(page)
  expect(await outlineOf(page, 'all2')).toBe('2px solid rgb(5, 150, 105) 3px')
})

test('the ring fades out when focus moves to something with no ring', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  const a = await rect(page, 'a')

  await focus(page, 'bare')
  await frames(page, 2)
  const fading = await ghost(page)
  expect(fading.flying).toBe(true)
  expect(fading.x).toBeCloseTo(a.x, 0)
  expect(fading.opacity).toBeLessThan(1)
  expect(await inlineStyle(page, 'bare')).toBeNull()
  await land(page)

  // And comes back from nothing afterwards.
  await focus(page, 'after-bare')
  await frames(page)
  const back = await ghost(page)
  expect(back.flying).toBe(true)
  expect(back.opacity).toBeLessThan(0.5)
  await land(page)
  expect(await inlineStyle(page, 'after-bare')).toBeNull()
})

test('data-fring="off" opts a subtree out', async ({ page }) => {
  await open(page)
  await focus(page, 'off')
  await frames(page, 3)
  expect((await ghost(page)).flying).toBe(false)
  expect(await inlineStyle(page, 'off')).toBeNull()
  expect(await computed(page, 'off', 'outlineStyle')).toBe('solid')
})

test('a mouse click that shows no focus ring starts nothing', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari does not focus buttons on click')
  await open(page)
  await page.click('#button')
  await frames(page, 3)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('button')
  expect((await ghost(page)).flying).toBe(false)
})

test('real Tab presses move the ring, including onto a button', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari only tabs to form fields by default')
  await open(page)
  await focusAndLand(page, 'off')
  await page.keyboard.press('Tab')
  await frames(page, 2)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('button')
  expect((await ghost(page)).flying).toBe(true)
  await land(page)
  expect(await inlineStyle(page, 'button')).toBeNull()
})

test('prefers-reduced-motion turns it off entirely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await focus(page, 'a')
  await frames(page, 3)
  await focus(page, 'round')
  await frames(page, 3)
  expect(await page.locator('fring-ghost').count()).toBe(0)
  expect(await inlineStyle(page, 'round')).toBeNull()
  expect(await outlineOf(page, 'round')).toBe('2px solid rgb(37, 99, 235) 2px')
})

test('changing direction mid-flight keeps the ring where it is', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  await frames(page, 5)
  const before = await ghost(page)

  await focus(page, 'pill')
  await frames(page)
  const after = await ghost(page)
  expect(after.flying).toBe(true)
  // One frame later it has moved on a little, not jumped.
  expect(Math.abs(after.x - before.x)).toBeLessThan(40)
  expect(after.x).toBeGreaterThan(before.x)
  // The abandoned destination has its styles back already.
  expect(await inlineStyle(page, 'round')).toBeNull()
  expect(await computed(page, 'pill', 'outlineStyle')).toBe('none')

  await land(page)
  expect(await inlineStyle(page, 'pill')).toBeNull()
})

test('holding Tab leaves nothing behind', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    await frames(page, 2)
  }
  await land(page)
  const leftovers = await page.evaluate(() =>
    [...document.querySelectorAll('[style]')]
      .filter((el) => /outline|shadow/.test(el.getAttribute('style') ?? ''))
      .map((el) => el.id),
  )
  expect(leftovers).toEqual([])
})

test('the destination disappearing mid-flight is handled', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'doomed')
  await frames(page, 3)
  expect((await ghost(page)).flying).toBe(true)
  await page.evaluate(() => document.getElementById('doomed')!.remove())
  await frames(page, 3)
  // No focus event fires for this. The ghost notices on its own and fades out.
  expect((await ghost(page)).opacity).toBeLessThan(1)
  await land(page)
})

test('a ring left on a removed element still flies from where it was', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'doomed')
  const was = await rect(page, 'doomed')
  await page.evaluate(() => {
    document.getElementById('doomed')!.remove()
    document.getElementById('a')!.focus()
  })
  await frames(page)
  const start = await ghost(page)
  expect(start.flying).toBe(true)
  expect(start.opacity).toBe(1)
  expect(start.x).toBeCloseTo(was.x, 0)
  expect(start.y).toBeCloseTo(was.y, 0)
  await land(page)
})

test('stop() mid-flight removes the ghost and restores the element', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  await frames(page, 3)
  expect(await computed(page, 'round', 'outlineStyle')).toBe('none')
  await page.evaluate(() => window.stop())
  expect(await page.locator('fring-ghost').count()).toBe(0)
  expect(await inlineStyle(page, 'round')).toBeNull()
  expect(await computed(page, 'round', 'outlineStyle')).toBe('solid')
})

test('a long stall finishes the flight instead of resuming it', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  await frames(page, 2)
  expect((await ghost(page)).flying).toBe(true)
  await frames(page, 1, 500)
  await frames(page, 12)
  expect((await ghost(page)).flying).toBe(false)
  expect(await inlineStyle(page, 'round')).toBeNull()
})

test('scrolling mid-flight carries the ring with the page', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  await frames(page, 4)
  const before = await ghost(page)
  const targetBefore = await rect(page, 'round')

  await page.evaluate(() => window.scrollBy(0, 30))
  await frames(page)
  const after = await ghost(page)
  const targetAfter = await rect(page, 'round')
  expect(targetAfter.y).toBeCloseTo(targetBefore.y - 30, 0)
  // Relative to its destination the ghost carried on as if nothing happened.
  expect(after.y - targetAfter.y).toBeCloseTo(before.y - targetBefore.y, 0)
  await land(page)
})

test('focusing something off-screen flies in from where the old element went', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'far')
  // Safari scrolls a focused element into view on its next rendering update.
  await page.waitForTimeout(100)
  await frames(page)
  const start = await ghost(page)
  const a = await rect(page, 'a')
  expect(a.y).toBeLessThan(0)
  expect(start.y).toBeCloseTo(a.y, 0)
  await land(page)
  expect(await inlineStyle(page, 'far')).toBeNull()
})

test('the ring is drawn above a modal dialog, even one opened mid-flight', async ({ page }) => {
  await open(page, { duration: 1500 })
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  await frames(page, 3)
  expect((await ghost(page)).inTopLayer).toBe(true)

  await page.evaluate(() => (document.getElementById('dialog') as HTMLDialogElement).showModal())
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('d1')
  await frames(page, 12)

  const now = await ghost(page)
  expect(now.flying).toBe(true)
  expect(now.inTopLayer).toBe(true)
  // The outline's left edge sits 2px to 4px outside the ghost. If the ghost
  // were under the dialog's backdrop that pixel would be dimmed.
  const shot = PNG.sync.read(await page.screenshot())
  const scale = shot.width / 1100
  const x = Math.round((now.x - 3) * scale)
  const y = Math.round((now.y + now.height / 2) * scale)
  const i = (y * shot.width + x) * 4
  expect([shot.data[i], shot.data[i + 1], shot.data[i + 2]]).toEqual([37, 99, 235])

  await land(page, 600)
  expect(await inlineStyle(page, 'd1')).toBeNull()
})

test('focus moving inside a shadow root is followed', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 's1')
  const s1 = await rect(page, 's1')
  await page.keyboard.press('Tab')
  await frames(page)
  expect(await page.evaluate(() => document.getElementById('host')!.shadowRoot!.activeElement?.id)).toBe('s2')
  const start = await ghost(page)
  expect(start.flying).toBe(true)
  expect(start.x).toBeCloseTo(s1.x, 0)
  expect(start.outline).toContain('rgb(124, 58, 237)')
  expect(await computed(page, 's2', 'outlineStyle')).toBe('none')
  await land(page)
  expect(await inlineStyle(page, 's2')).toBeNull()
  expect(await computed(page, 's2', 'outlineStyle')).toBe('solid')
})

test('the ghost is only clipped as it arrives at a clipped ring', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'clip1')
  await frames(page)
  expect((await ghost(page)).clip).toBe('none')

  let tight = ''
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    tight = now.clip
  }
  expect(tight).toContain('inset(')
})

test('a link that wraps onto two lines dissolves instead of landing as a box', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari only tabs to form fields by default')
  await open(page)
  await focusAndLand(page, 'after-wrapped')
  await page.keyboard.press('Shift+Tab')
  await frames(page, 4)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('wrapped')
  const now = await ghost(page)
  expect(now.flying).toBe(true)
  expect(now.opacity).toBeLessThan(1)
  // Its own ring is not held back: the browser draws it per line straight away.
  expect(await inlineStyle(page, 'wrapped')).toBeNull()
  expect(await computed(page, 'wrapped', 'outlineStyle')).toBe('solid')
  await land(page)
})

test('nothing is added to the page until focus first moves', async ({ page }) => {
  await open(page)
  expect(await page.locator('fring-ghost').count()).toBe(0)
  expect(await page.locator('[style]').count()).toBe(0)
})

test('at rest it asks for no frames, and typing in a ringed field asks for none', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  expect(await page.evaluate(() => window.__queued())).toBe(0)
  await page.keyboard.type('hello world')
  await page.keyboard.press('ArrowLeft')
  expect(await page.evaluate(() => window.__queued())).toBe(0)
  expect(await page.locator('#a').inputValue()).toContain('hello world')
})

test('data-fring="within" puts the ring on a group, and moving inside it is not a flight', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  const group = await rect(page, 'group')

  await focus(page, 'g1')
  await frames(page, 2)
  expect((await ghost(page)).flying).toBe(true)
  expect(await computed(page, 'group', 'outlineStyle')).toBe('none')
  let last = await ghost(page)
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    last = now
  }
  expect(last.x).toBeCloseTo(group.x, 1)
  expect(last.width).toBeCloseTo(group.width, 1)
  expect(parseFloat(last.radius)).toBe(8)
  expect(await inlineStyle(page, 'group')).toBe(null)
  expect(await computed(page, 'group', 'outlineStyle')).toBe('solid')

  await focus(page, 'g2')
  await frames(page, 3)
  expect((await ghost(page)).flying).toBe(false)
  expect(await computed(page, 'group', 'outlineStyle')).toBe('solid')

  await focus(page, 'a')
  await frames(page)
  const leaving = await ghost(page)
  expect(leaving.flying).toBe(true)
  expect(leaving.x).toBeCloseTo(group.x, 0)
  expect(leaving.width).toBeCloseTo(group.width, 0)
  await land(page)
})

test('a ring that only shows up once a key is pressed settles in', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'only Chromium turns :focus-visible on for a modifier key')
  await open(page)
  await page.click('#button')
  await frames(page, 3)
  expect((await ghost(page)).flying).toBe(false)
  // The button has focus but no ring. A key press turns :focus-visible on.
  await page.keyboard.press('Shift')
  await frames(page)
  const now = await ghost(page)
  expect(now.flying).toBe(true)
  expect(now.opacity).toBeLessThan(0.5)
  await land(page)
  expect(await computed(page, 'button', 'outlineStyle')).toBe('solid')
})

test('works under a Content-Security-Policy that forbids inline styles', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari only tabs to form fields by default')
  await open(page, {}, '/csp.html')
  await page.keyboard.press('Tab')
  await frames(page, 2)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('a')
  await land(page)
  const a = await rect(page, 'a')

  await page.keyboard.press('Tab')
  await frames(page)
  const start = await ghost(page)
  expect(start.flying).toBe(true)
  expect(start.y).toBeCloseTo(a.y, 0)
  expect(start.outline).toContain('auto')
  await frames(page, 3)
  const moving = await ghost(page)
  expect(moving.y).toBeGreaterThan(start.y + 1)
  await land(page)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('b')
})

test('the ring stretches toward where it is going, then the back catches up', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  const from = await rect(page, 'a')
  const to = await rect(page, 'round')
  expect(to.width).toBe(from.width)

  await focus(page, 'round')
  let widest = 0
  let last = await ghost(page)
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    widest = Math.max(widest, now.width)
    // Never narrower than the things it is flying between, and never past the far side.
    expect(now.width).toBeGreaterThanOrEqual(from.width - 0.5)
    expect(now.x + now.width).toBeLessThanOrEqual(to.x + to.width + 2)
    last = now
  }
  expect(widest).toBeGreaterThan(from.width + 8)
  expect(last.width).toBe(to.width)
  expect(last.x).toBe(to.x)
})

test('a short hop lands sooner than a long one', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'round')
  const short = await land(page)

  await focusAndLand(page, 'a')
  await focus(page, 'red')
  const long = await land(page)
  expect(long).toBeGreaterThan(short + 2)
})

/**
 * Most of a flight is drawn as four quarters moved by the compositor. These
 * check that it happens, and that the quarters make the same picture as one
 * box wearing the same ring.
 */
test('a flight runs on the compositor and finishes on one exact box', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'all1')
  await focus(page, 'all2')
  const modes: string[] = []
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    modes.push(now.mode)
  }
  expect(modes.filter((mode) => mode === 'composed').length).toBeGreaterThan(modes.length * 0.7)
  expect(modes.at(-1)).toBe('painted')
})

test('a ring changing shape goes to the compositor once its corners have settled', async ({ page }) => {
  await open(page)
  await focusAndLand(page, 'a')
  await focus(page, 'pill')
  const modes: string[] = []
  for (let i = 0; i < 240; i++) {
    await frames(page)
    const now = await ghost(page)
    if (!now.flying) break
    modes.push(now.mode)
  }
  // Painted while the square corners round off, composed for the rest, painted to land.
  expect(modes[0]).toBe('painted')
  expect(modes.at(-1)).toBe('painted')
  expect(modes.indexOf('composed')).toBeGreaterThan(0)
  expect(modes.filter((mode) => mode === 'composed').length).toBeGreaterThan(modes.length * 0.4)
})

for (const [from, to] of [
  ['all1', 'all2'],
  ['shadow1', 'shadow2'],
  ['bordered1', 'bordered2'],
  ['native1', 'native2'],
  ['round', 'a'],
] as [from: string, to: string][]) {
  test(`four quarters draw the same ring as one box, flying to #${to}`, async ({ page }, info) => {
    test.skip(
      info.project.name === 'chromium-1.5x',
      'emulated scaling rounds painted boxes to CSS pixels and composited ones to device pixels',
    )
    await open(page)
    await focusAndLand(page, from)
    await focus(page, to)
    let composed = false
    for (let i = 0; i < 60 && !composed; i++) {
      await frames(page)
      composed = (await ghost(page)).mode === 'composed'
    }
    expect(composed).toBe(true)
    await frames(page, 2)
    const now = await ghost(page)
    expect(now.mode).toBe('composed')
    const clip = {
      x: Math.floor(now.x - 20),
      y: Math.floor(now.y - 20),
      width: Math.ceil(now.width + 40),
      height: Math.ceil(now.height + 40),
    }
    const quarters = await page.screenshot({ clip })

    // Swap the quarters for a plain element with the same box and the same ring.
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('fring-ghost')!
      const wings = [...host.shadowRoot!.querySelectorAll<HTMLElement>('s')]
      const first = wings[0]!.getBoundingClientRect()
      const third = wings[2]!.getBoundingClientRect()
      const cs = getComputedStyle(wings[0]!)
      const corner = (i: number, name: string) => getComputedStyle(wings[i]!).getPropertyValue(name)
      const reference = document.createElement('div')
      reference.style.cssText = `position:fixed;box-sizing:border-box;pointer-events:none;z-index:2147483647;
        left:${first.left}px;top:${first.top}px;width:${third.right - first.left}px;height:${third.bottom - first.top}px;
        border:0 solid transparent;border-width:${cs.borderWidth};
        outline:${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor};outline-offset:${cs.outlineOffset};
        box-shadow:${cs.boxShadow};
        border-top-left-radius:${corner(0, 'border-top-left-radius')};
        border-top-right-radius:${corner(1, 'border-top-right-radius')};
        border-bottom-right-radius:${corner(2, 'border-bottom-right-radius')};
        border-bottom-left-radius:${corner(3, 'border-bottom-left-radius')}`
      // The host's own stylesheet outranks inline styles, so take it off the page.
      host.remove()
      document.body.append(reference)
    })
    const one = await page.screenshot({ clip })
    if (process.env.FRING_DEBUG) {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      mkdirSync('test-results/seams', { recursive: true })
      writeFileSync(`test-results/seams/${info.project.name}-q${to}-ghost.png`, quarters)
      writeFileSync(`test-results/seams/${info.project.name}-q${to}-landed.png`, one)
    }
    // Chromium draws its own default ring with half a dozen faintly different
    // corner pixels when the box is one of the quarters. Everything else is exact.
    expect(differingPixels(quarters, one)).toBeLessThanOrEqual(8)
  })
}

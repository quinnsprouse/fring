import { expect, test, type Page } from '@playwright/test'

/**
 * The demo site runs fring through the React component, on the real clock.
 * These check the wiring. The frame-by-frame behaviour is in fring.spec.ts.
 */
const SITE = 'http://localhost:5198/'

declare global {
  interface Window {
    /** How many times the ghost has been put on screen. */
    __flights: number
  }
}

const flights = (page: Page) => page.evaluate(() => window.__flights)
const flying = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('fring-ghost')?.shadowRoot
    return ['i', 'b'].some((name) => root?.querySelector<HTMLElement>(name)?.style.display === 'block')
  })

/** Clicks something in the tiles and waits for the ring to arrive and land. */
async function clickAndLand(page: Page, label: string) {
  const before = await flights(page)
  await page.getByLabel(label, { exact: true }).click()
  await expect.poll(() => flights(page)).toBe(before + 1)
  await expect.poll(() => flying(page)).toBe(false)
}

const errors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const seen: string[] = []
  errors.set(page, seen)
  page.on('pageerror', (error) => seen.push(String(error)))
  await page.addInitScript(() => {
    // A flight is the ghost going from drawing nothing to drawing something.
    // Watch the styles inside its shadow root for that.
    window.__flights = 0
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, init)
      if (this.localName === 'fring-ghost') {
        let drawn = false
        new MutationObserver(() => {
          const now = ['i', 'b'].some((name) => root.querySelector<HTMLElement>(name)?.style.display === 'block')
          if (now && !drawn) window.__flights++
          drawn = now
        }).observe(root, { attributes: true, subtree: true, attributeFilter: ['style'] })
      }
      return root
    }
  })
  await page.goto(SITE)
  await page.waitForSelector('.tiles')
})

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([])
})

test('<Fring /> animates focus, and unmounting it stops', async ({ page }) => {
  await clickAndLand(page, 'Email')

  const before = await flights(page)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Invite code')).toBeFocused()
  await expect.poll(() => flights(page)).toBe(before + 1)
  await expect.poll(() => flying(page)).toBe(false)
  // Nothing of fring's is left behind on the fields.
  const leftovers = await page.evaluate(
    () =>
      [...document.querySelectorAll('.tiles [style]')].filter((el) =>
        /outline|shadow/.test(el.getAttribute('style') ?? ''),
      ).length,
  )
  expect(leftovers).toBe(0)

  await page.getByRole('switch', { name: 'fring' }).click()
  await expect(page.locator('fring-ghost')).toHaveCount(0)
  const stopped = await flights(page)
  await page.getByLabel('Email').click()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  expect(await flights(page)).toBe(stopped)
  await expect(page.locator('fring-ghost')).toHaveCount(0)
})

test('the tour moves real focus through the tiles', async ({ page }) => {
  await page.getByRole('button', { name: 'watch a tour' }).click()
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('.tiles')), { timeout: 3000 })
    .toBe(true)
  await expect.poll(() => flights(page), { timeout: 3000 }).toBeGreaterThanOrEqual(2)
  // A key press hands control back.
  await page.keyboard.press('Shift')
  await expect(page.getByRole('button', { name: 'watch a tour' })).toBeVisible()
})

test('the stand-in ring retires at the first key press', async ({ page }) => {
  const standIn = page.locator('.stand-in')
  await expect(standIn).toHaveAttribute('data-on', '', { timeout: 3000 })
  await page.keyboard.press('Shift')
  await expect(standIn).not.toHaveAttribute('data-on')
})

test('choosing a shape changes the colour of the real ring', async ({ page }) => {
  await page.getByRole('button', { name: 'Moss' }).click()
  // The click focuses the shape everywhere but Safari. Let that flight, if any, finish.
  await page.waitForTimeout(300)
  await expect.poll(() => flying(page)).toBe(false)
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'moss')
  await clickAndLand(page, 'Email')
  const outline = await page.getByLabel('Email').evaluate((el) => getComputedStyle(el).outlineColor)
  expect(outline).toBe('rgb(24, 146, 78)')
})

test('the invite button counts its steps and starts over', async ({ page }) => {
  const button = page.locator('.invite button')
  await button.click()
  await expect(button).toHaveAccessibleName('Confirm')
  await button.click()
  await expect(button).toHaveAccessibleName('Done')
  await expect(button).toHaveAccessibleName('Continue', { timeout: 4000 })
})

test('choosing a package manager rewrites the install command', async ({ page }) => {
  await page.getByRole('button', { name: 'pnpm' }).click()
  // torph keeps a second copy of the text for screen readers, so match part of it.
  await expect(page.locator('.install code')).toContainText('pnpm add fring')
  await page.getByRole('button', { name: 'bun' }).click()
  await expect(page.locator('.install code')).toContainText('bun add fring')
  await expect(page.locator('.install code')).not.toContainText('pnpm')
})

test('tabs keep one tab stop and move with the arrow keys', async ({ page }) => {
  await page.getByRole('tab', { name: 'React' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Anything else' })).toBeFocused()
  await expect(page.getByRole('tabpanel')).toContainText("import { fring } from 'fring'")
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tabpanel')).toContainText("from 'fring/react'")
})

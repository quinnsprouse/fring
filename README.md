# fring

Your focus ring, in motion.

When you press Tab, the focus ring vanishes from one element and appears on the next. fring makes it glide there instead. It animates the ring your CSS already draws, so there is nothing to restyle and no ring of its own to theme.

5.9 kB gzipped. No dependencies.

```sh
npm i fring
```

## Use it

In React, render the component once. It draws nothing in your tree.

```tsx
import { Fring } from 'fring/react'

export default function Layout({ children }) {
  return (
    <>
      <Fring />
      {children}
    </>
  )
}
```

Anywhere else, call the function once in the browser. It returns a function that stops it.

```ts
import { fring } from 'fring'

const stop = fring()
```

In Vue call it in `onMounted`, in Svelte in `onMount`. It is safe to call during server rendering, where it does nothing.

With no build step, one script tag starts it.

```html
<script src="https://unpkg.com/fring" defer></script>
```

## What it animates

Whatever ring the focused element shows. fring reads the element's computed `outline` and `box-shadow` and flies exactly that, so all of these work without changes:

```css
/* A plain outline. */
:focus-visible {
  outline: 2px solid royalblue;
  outline-offset: 2px;
}

/* A box-shadow ring. Tailwind's ring utilities and shadcn/ui draw this. */
.input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(65 105 225 / 0.4);
}

/* No focus CSS at all. The browser's default ring glides too. */
```

A different ring on different elements is fine. The ring blends from one colour, width and offset to the next as it travels, and its corners take the shape of each element's `border-radius`.

The ring moves like a thing with some weight. The edge facing the way it is going sets off first and the edge behind catches up, so it stretches toward its destination and settles as it lands. A hop across the screen takes a little longer than a hop to the next button.

If an element shows no ring when focused, fring does nothing for it. Styling the ring is still your CSS's job.

## Options

```tsx
<Fring duration={250} bounce={0.1} />
```

```ts
fring({ duration: 250, bounce: 0.1 })
```

| Option | Default | |
| --- | --- | --- |
| `duration` | `250` | How long a typical hop feels, in milliseconds. Short hops are a little quicker and long ones a little slower. |
| `bounce` | `0.1` | How much the spring overshoots. `0` never does. The maximum is `0.6`. |
| `document` | `document` | Core only. Pass an iframe's document to run inside it. |

Two attributes cover the cases the options cannot.

`data-fring="off"` leaves an element and everything inside it alone. Its focus ring behaves as it would without fring.

`data-fring="within"` goes on a wrapper that shows its ring with `:focus-within`, such as a search box with a button inside it. The ring flies to the wrapper. Moving focus between two fields inside one wrapper is not a flight.

```html
<div class="search" data-fring="within">
  <input type="search" />
  <button>Go</button>
</div>
```

## How it works

At rest fring does nothing. The ring on screen is the browser's own outline, drawn by the browser on the focused element. No timers or animation frames run and no observer fires. After the first focus change one empty element stays on the page, in the top layer, ready for the next flight.

When focus moves, a copy of the ring in the top layer rides a spring from the old element to the new one. While it is in the air the new element's own ring is held back with a few inline styles, so there is only ever one ring on screen. On the frame after the copy arrives, it is hidden and the inline styles are removed.

That hand-off is the part that has to be right, so the test suite takes a screenshot of the copy's last frame and of the browser's ring that replaces it, then counts the pixels that differ. For outlines the count is zero in Chromium, Firefox and WebKit, and in Chromium at a 1.5x pixel ratio.

A few things follow from this design:

- A scrolling page, a sticky header or a layout shift cannot leave the ring behind, because at rest there is no ring of fring's to leave.
- The ring draws above modal dialogs and popovers during a flight, including ones that open while it is in the air.
- Scrolling mid-flight carries the ring along, because it is positioned relative to where its destination is on each frame.
- Changing direction mid-flight keeps the ring's velocity, so holding Tab looks like one motion.
- A long frame or a sleeping tab never plays back in slow motion. The spring is solved exactly for the time that passed.
- The copy lives in a shadow root. Page styles cannot reach it and MutationObservers on the page do not see it change.
- There is no stylesheet to inject, so a Content Security Policy that forbids inline styles is fine.

## Accessibility

fring changes how the ring gets to an element, never whether it is there. Focus order, focus events and what assistive technology hears are untouched.

Under `prefers-reduced-motion: reduce` it turns itself off and focus behaves as the browser does it.

## Browser support

Chrome and Edge 114, Safari 17, Firefox 125. fring needs the Popover API to draw above dialogs, and it checks for it before doing anything. Older browsers keep their normal focus ring.

## Performance

Moving a box around a page is cheap to write and can be expensive to run. Two things in fring exist only to make a flight cost the browser as little as possible.

**The flight runs on the compositor.** Changing an element's position and size makes a browser lay out and repaint, and in Chrome a repaint walks the display list of the whole page. On a large page every frame then costs as much as the page is big. So for most of a flight fring draws the ring as four clipped quarters and changes nothing but their transforms, which the compositor applies with no layout and no paint. Each quarter is scaled and the box inside it is scaled back, so the ring is never stretched or thinned. The tests compare the quarters against a single box wearing the same ring. They match, give or take half a dozen antialiased corner pixels on Chromium's default ring. A single painted box is still used while the corners change shape, while one ring style blends into another, and for the final frame.

**Chrome is not told the flight belongs to your key press.** Chrome watches what a key press or click goes on to change, frame after frame, so it can time in-page navigations. That watching forces a repaint on every frame of an animation started from a key press, which is exactly what a focus animation is. A ResizeObserver callback is not part of the interaction, so fring wakes itself through one and its frames are left alone.

`npm run perf` records a Chromium trace of 150 Tab presses through a page of 13,000 elements and adds up everything the browser did. Tracing slows the browser down, so compare the columns, not the clock. On an Apple M5 Pro:

| Added per focus change | Before these two | Now |
| --- | --- | --- |
| Paint | 2.7 ms | none |
| Layout | 0.5 ms | none |
| Everything, including script and style | 4.2 ms | 0.8 ms |

`npm run bench` times fring's own script one step at a time. In Chromium a takeoff takes about 20 µs and each frame of a flight about 11 µs. Firefox and WebKit take 37 µs and 60 µs a frame. I have no way to trace paint in those two, so the table above is Chromium only.

Typing in a field that already shows its ring schedules nothing.

## Limits

- **Rings drawn another way.** fring sees `outline` and centred `box-shadow` layers. A focus style made only of a border colour, a background or a pseudo-element is not something it can fly.
- **Box-shadow rings on rounded corners.** The browser paints a shadow under its element's border and the copy is painted over it. At the hand-off a few dozen antialiased corner pixels shift by a shade. I cannot see it, but the tests can, and they allow it.
- **Unstyled native controls.** Firefox and Safari let the operating system draw the default ring on an unstyled `<input>` or `<button>`, and a copy cannot match it to the pixel. Once a control has a border or background of your own, the hand-off is exact. Chromium differs on unstyled controls too, by a few corner pixels.
- **Links that wrap onto two lines.** The browser outlines each line separately. The ring flies toward the link and dissolves into that outline instead of landing as one box.
- **Rings a neighbour covers.** In flight the ring is drawn above everything. At rest it is the element's own outline again, so a later sibling with a background can paint over part of it, as it would without fring. Tightly packed buttons want a ring inside the edge (`outline-offset: -2px`) or `position: relative; z-index: 1` while focused.
- **Rotated elements.** The ring flies to the element's bounding box.
- **Keyframe animations on `outline`.** Transitions on the ring are handled. A looping `@keyframes` animation on it is not.
- **Iframes.** Each document needs its own `fring({ document })` call, and the ring does not fly between documents.

## Development

```sh
npm install
npx playwright install chromium firefox webkit

npm run dev        # the demo site, against the source
npm test           # Playwright, in all three engines
npm run typecheck
npm run build
npm run size
npm run perf       # where the browser's time goes, from a trace
npm run bench      # fring's own script, step by step
```

Most tests drive `requestAnimationFrame` by hand, so each assertion is about a known frame of the flight.

## License

MIT

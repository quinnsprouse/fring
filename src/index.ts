/**
 * fring: your focus ring, in motion.
 *
 * How it works, in one paragraph. At rest the focus ring on screen is the
 * browser's own outline (or your box-shadow ring), drawn by the browser on the
 * focused element. fring does nothing at rest: no observers, no timers, no
 * frames. When focus moves, a "ghost" in the top layer copies the ring's look,
 * flies from the old element to the new one on a spring, and is hidden the
 * moment it lands. While it is in the air the destination's own ring is held
 * back, so there is only ever one ring on screen.
 */

export interface FringOptions {
  /**
   * How long a typical hop feels, in milliseconds. Short hops are a little
   * quicker than this and long ones a little slower, the way a thrown object
   * takes longer to go further.
   * @default 250
   */
  duration?: number
  /**
   * Spring bounce. 0 never overshoots, 0.3 is lively. Clamped to 0 through 0.6.
   * @default 0.1
   */
  bounce?: number
  /**
   * The document to animate focus in. Pass an iframe's document to run inside it.
   * @default document
   */
  document?: Document
}

/** Stops fring and removes everything it added. */
export type Stop = () => void

type Outline = readonly [style: string, width: string, color: string, offset: string]

/** What we learned about an element just before it took focus. */
interface Glimpse {
  /** The element about to be focused. */
  for: Element
  /** The element that will wear its ring, or null if it is opted out. */
  subject: Element | null
  top: Element | null
  /** The wearer's outline and box-shadow before focus, when we could read them. */
  outline: Outline | null
  shadow: string
}

/** The focus ring of one element, as the ghost needs to know it. */
interface Ring {
  /** The element wearing the ring. Usually the focused one; see `data-fring="within"`. */
  el: Element
  /** Where it was when the ring was read. */
  box: DOMRect
  /** The outline focus added, or null if focus did not add one. */
  outline: Outline | null
  /** The box-shadow layers focus added, or '' if none. */
  shadow: string
  /** What to hold the element's outline at while the ghost is in the air. */
  restOutline: Outline | null
  /** What to hold the element's box-shadow at while the ghost is in the air. */
  restShadow: string | null
  /** The element's focused box-shadow with the ring layers taken out. */
  bareShadow: string
  /** The element's four border widths, which change where some rings are painted. */
  border: string
  /** Used corner radii: four horizontal, then four vertical. */
  radii: number[]
  /** How far the ring paints outside the border box. */
  extent: number
  /** The element has CSS transitions that could fight the hand-off. */
  animated: boolean
  /** The element wraps onto several lines; the ghost dissolves instead of landing. */
  fade: boolean
  /** This ring can fly on the compositor. See `compose`. */
  fast: boolean
  /** Ancestors that clip the element, innermost first. Worked out only if the ring gets close. */
  clips: Element[] | null
  /** The top-layer element this ring sits inside, if any. */
  top: Element | null
  /** Two rings with the same key look the same. */
  key: string
}

/** A destination's own ring, held back while the ghost flies to it. */
interface Hold {
  el: Element
  bare(): void
  thaw(): void
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Controller {
  users: number
  configure(options: FringOptions): void
  destroy(): void
}

const TAG = 'fring-ghost'
const OUTLINE = ['outline-style', 'outline-width', 'outline-color', 'outline-offset'] as const
const CORNERS = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const
const TOP_LAYER = ':modal,:popover-open,:fullscreen'
const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]'
/** Values per flight: left, top, right and bottom edges, then eight radii. */
const N = 12
/**
 * The edge facing the direction of travel runs on a quicker spring than the
 * edge behind it, so the ring stretches toward where it is going and the back
 * catches up as it lands. These scale the spring's duration for each.
 */
const LEAD = 0.9
const TRAIL = 1.1
/**
 * Corner radii settle in half the time. The ring takes its new shape early in
 * the flight, and the rest of the flight can run on the compositor.
 */
const ROUND = 0.5
/** Travel under this many px is a resize, not a direction. */
const DIRECTION = 4
/** How long the ghost takes to blend from one ring style to another, in ms. */
const LOOK_MS = 150
/** How far outside its target the ring starts when it appears from nothing, in px. */
const GROW = 6
/** Opacity time constant, in seconds. */
const FADE = 0.035
/** A frame longer than this means the tab was asleep; finish instead of resuming. */
const STALL = 0.1
/** Within this many px of landing, find out whether anything will clip the ring. */
const NEAR = 48
/** A frame, in seconds, until fring has seen how long this display's frames are. */
const FRAME = 1 / 60
/** Size of a quadrant's clip box before it is scaled, and of the box inside it. */
const CLIP = 128
const WING = 1280

/**
 * Everything fring draws lives in a shadow root, where page styles cannot reach
 * it and its per-frame changes are invisible to MutationObservers on the page.
 * The host is a zero-size box pinned to the viewport's corner in the top layer.
 *
 * Inside are two ways of drawing the same ring. `i` is one box that wears the
 * ring. `b` holds four clipped quarters of it. See `compose`. `em` draws
 * nothing; its width is how fring wakes itself up. See `poke`.
 */
const LOOK = ['outline-color', 'outline-width', 'outline-offset', 'box-shadow']
  .map((prop) => `${prop} ${LOOK_MS}ms ease-out`)
  .join()
const SHEET =
  ':host{all:initial!important;position:fixed!important;inset:0 auto auto 0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;display:block!important}' +
  ':host(:not(:popover-open)){display:none!important}' +
  'i,s{box-sizing:border-box;border:0 solid transparent}' +
  `i{position:absolute;display:none;transition:${LOOK}}` +
  'b{position:absolute;inset:0 auto auto 0;display:none;will-change:opacity}' +
  'u,s{position:absolute;left:0;top:0;display:block;transform-origin:0 0;will-change:transform}' +
  `u{width:${CLIP}px;height:${CLIP}px;overflow:clip}` +
  `s{width:${WING}px;height:${WING}px}` +
  'em{position:absolute;visibility:hidden;width:0;height:0}'

const noop: Stop = () => {}

const controllers = new WeakMap<Document, Controller>()

/**
 * Start animating the focus ring. Returns a function that stops it.
 *
 * Safe to call on the server (it does nothing) and safe to call more than once
 * (calls share one instance, the latest options win, and it stops when every
 * caller has stopped).
 */
export function fring(options: FringOptions = {}): Stop {
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document)
  if (!doc || !supported(doc)) return noop

  let controller = controllers.get(doc)
  if (!controller) controllers.set(doc, (controller = create(doc)))
  controller.users++
  controller.configure(options)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (--controller.users === 0) {
      controller.destroy()
      controllers.delete(doc)
    }
  }
}

/**
 * fring needs the top layer (the Popover API), constructable stylesheets,
 * ResizeObserver and the Web Animations API: Chrome and Edge 114, Safari 17,
 * Firefox 125.
 * Anything older is left alone and keeps its normal focus ring.
 */
function supported(doc: Document): boolean {
  const win = doc.defaultView
  if (!win) return false
  try {
    return (
      'showPopover' in win.HTMLElement.prototype &&
      'getAnimations' in win.Element.prototype &&
      'adoptedStyleSheets' in doc &&
      'ResizeObserver' in win
    )
  } catch {
    return false
  }
}

/**
 * A damped spring toward zero, solved exactly so it is the same at 60Hz and
 * 120Hz and never explodes on a long frame.
 */
interface Spring {
  w0: number
  /** Decay rate. */
  a: number
  /** Damped frequency, or 0 when critically damped. */
  wd: number
  // The three terms below depend only on the frame's dt. `prime` works them
  // out once per frame so each value costs a handful of multiplications.
  e: number
  c: number
  s: number
  dt: number
}

function spring(duration: number, bounce: number): Spring {
  const w0 = (2 * Math.PI) / (Math.max(duration, 1) / 1000)
  const zeta = 1 - Math.min(Math.max(bounce, 0), 0.6)
  const wd = w0 * Math.sqrt(Math.max(1 - zeta * zeta, 0))
  return { w0, a: zeta * w0, wd: wd > 1e-6 ? wd : 0, e: 1, c: 1, s: 0, dt: 0 }
}

function prime(sp: Spring, dt: number) {
  sp.dt = dt
  sp.e = Math.exp(-sp.a * dt)
  sp.c = Math.cos(sp.wd * dt)
  sp.s = Math.sin(sp.wd * dt)
}

function move(sp: Spring, x: Float64Array, v: Float64Array, i: number) {
  const x0 = x[i]!
  const v0 = v[i]!
  if (sp.wd) {
    x[i] = sp.e * (x0 * sp.c + ((v0 + sp.a * x0) / sp.wd) * sp.s)
    v[i] = sp.e * (v0 * sp.c - ((sp.a * v0 + sp.w0 * sp.w0 * x0) / sp.wd) * sp.s)
  } else {
    const k = v0 + sp.w0 * x0
    x[i] = sp.e * (x0 + k * sp.dt)
    v[i] = sp.e * (v0 - sp.w0 * k * sp.dt)
  }
}

/** Splits a computed box-shadow into layers, ignoring commas inside colors. */
function layers(shadow: string): string[] {
  if (!shadow || shadow === 'none') return []
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < shadow.length; i++) {
    const c = shadow.charCodeAt(i)
    if (c === 40) depth++
    else if (c === 41) depth--
    else if (c === 44 && depth === 0) {
      out.push(shadow.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(shadow.slice(start).trim())
  return out
}

/** The x, y, blur and spread of one computed shadow layer, in px. */
function lengths(layer: string): number[] {
  let s = layer
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/\([^()]*\)/g, '')
  }
  return (s.match(/-?[\d.]+(?:e-?\d+)?px/g) ?? []).map(parseFloat)
}

/** A shadow centred on the element reads as a ring; an offset one is elevation. */
function isRing(layer: string): boolean {
  const [x, y, blur = 0, spread = 0] = lengths(layer)
  return x === 0 && y === 0 && (blur > 0 || spread > 0)
}

function reach(layer: string): number {
  if (/\binset\b/.test(layer)) return 0
  const [, , blur = 0, spread = 0] = lengths(layer)
  return blur + spread
}

function running(durations: string): boolean {
  return durations.split(',').some((duration) => parseFloat(duration) > 0)
}

/**
 * The radii the browser actually paints: percentages resolved, then scaled
 * down together when adjacent corners would overlap (CSS Backgrounds 3 §5.5).
 */
function radii(cs: CSSStyleDeclaration, width: number, height: number): number[] {
  const corners = [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius,
  ]
  const resolve = (value: string | undefined, of: number) => {
    const n = parseFloat(value ?? '')
    if (!(n > 0)) return 0
    return value!.endsWith('%') ? (n / 100) * of : n
  }
  const out: number[] = new Array(8)
  for (let i = 0; i < 4; i++) {
    const [h, v] = corners[i]!.split(' ')
    out[i] = resolve(h, width)
    out[i + 4] = resolve(v ?? h, height)
  }
  const fit = (size: number, a: number, b: number) => (a + b > 0 ? size / (a + b) : 1)
  const f = Math.min(
    1,
    fit(width, out[0]!, out[1]!),
    fit(width, out[3]!, out[2]!),
    fit(height, out[4]!, out[7]!),
    fit(height, out[5]!, out[6]!),
  )
  if (f < 1) for (let i = 0; i < 8; i++) out[i]! *= f
  return out
}

/** Parent across shadow roots and slots. */
function parent(el: Element): Element | null {
  return el.assignedSlot ?? el.parentElement ?? (el.getRootNode() as Partial<ShadowRoot>).host ?? null
}

function matches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

const px = (n: number) => `${Math.round(n * 1000) / 1000}px`

function create(doc: Document): Controller {
  const win = doc.defaultView!
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)')

  let duration = 250
  let bounce = 0.1
  // Four springs: edges that are only resizing, edges leading the way, edges
  // trailing behind, and corner radii.
  let springs: Spring[] = [spring(duration, bounce), spring(duration, bounce), spring(duration, bounce), spring(duration, 0)]
  /** Which of those each value rides. The radii always ride the last. */
  const rides = new Uint8Array(N).fill(3, 4)

  // What fring draws with. Built on the first flight, kept until it is stopped.
  let host: HTMLElement | null = null
  /** One box wearing the ring. */
  let ghost: HTMLElement | null = null
  /** Four clipped quarters of the ring. */
  let flock: HTMLElement | null = null
  let quarters: HTMLElement[] = []
  let wings: HTMLElement[] = []
  /** An invisible element whose width is flipped to wake fring up. See `poke`. */
  let bell: HTMLElement | null = null
  let rung = false
  let ringing = false
  let observer: ResizeObserver | null = null
  /** 0 nothing is drawn, 1 the single box is, 2 the four quarters are. */
  let mode = 0
  /** The top-layer element the host was last raised above. */
  let raisedOver: Element | null = null
  // The last value written for each style, so nothing is written twice.
  let written: Record<string, string> = {}
  let dressed: Record<string, string> = {}
  let corners: string[] = []
  let moved: string[] = []
  let faded = ''

  // Focus state.
  /** The focused element last seen, and whether it matched :focus-visible. */
  let seen: Element | null = null
  let visible = false
  let inShadow = false
  /** The element that would wear the ring for `seen`, ring or not. */
  let wearer: Element | null = null
  /** The ring currently on screen, whether the browser or the ghost is drawing it. */
  let cur: Ring | null = null
  /** What the element about to take focus looked like. */
  let pending: Glimpse | null = null

  // Flight state.
  let flying = false
  /** Where the ghost is heading, or null while it fades out in place. */
  let dest: Ring | null = null
  /** The ghost has been drawn exactly on its destination; the next frame hands off. */
  let arrived = false
  /** The destination's own ring, held back until the ghost lands. */
  let held: Hold | null = null
  /** The destination's box, when this frame has already measured it. */
  let fresh: DOMRect | null = null
  /** The ghost's four edges and its radii, in viewport px. */
  const abs = new Float64Array(N)
  /** The ghost's offset from its destination. This is what the springs drive to zero. */
  const d = new Float64Array(N)
  const v = new Float64Array(N)
  let opacity = 0
  let opacityTo = 0
  /** When the last frame was, or -1 if the last frame did not know the time. */
  let last = -1
  /** How long a frame lasts on this display, in seconds. */
  let frame = FRAME
  /**
   * When the single box last started blending from one look to another.
   * Infinity means "on a frame that did not know the time".
   */
  let lookAt = -1e9

  // Where the last flight landed, for when the element is gone by the next one.
  let landedOn: Element | null = null
  let landedAt: Box | null = null

  let raf = 0
  let dirty = false

  function build() {
    host = doc.createElement(TAG)
    host.setAttribute('popover', 'manual')
    host.setAttribute('aria-hidden', 'true')
    const root = host.attachShadow({ mode: 'open' })
    // A constructed sheet, not a <style>: nothing for a strict CSP to block.
    const sheet = new win.CSSStyleSheet()
    sheet.replaceSync(SHEET)
    root.adoptedStyleSheets = [sheet]

    ghost = doc.createElement('i')
    flock = doc.createElement('b')
    quarters = []
    wings = []
    for (let i = 0; i < 4; i++) {
      const quarter = doc.createElement('u')
      const wing = doc.createElement('s')
      quarter.append(wing)
      flock.append(quarter)
      quarters.push(quarter)
      wings.push(wing)
    }
    bell = doc.createElement('em')
    root.append(ghost, flock, bell)
    observer = new win.ResizeObserver(answer)
    observer.observe(bell)

    mode = 0
    written = {}
    dressed = {}
    corners = ['', '', '', '']
    moved = ['', '', '', '', '', '', '', '']
    faded = ''
  }

  /**
   * Makes sure the host is on the page and in the top layer. It stays there
   * between flights with nothing displayed inside it, so a flight through
   * ordinary page content costs no trip in and out of the top layer.
   */
  function ensure(): boolean {
    if (!doc.body) return false
    if (!host) build()
    try {
      // Page transitions and some frameworks replace <body>; follow it.
      if (!host!.isConnected) doc.body.append(host!)
      if (!host!.matches(':popover-open')) host!.showPopover()
      return true
    } catch {
      return false
    }
  }

  /** Puts the host back on top of the pile, above a dialog or popover opened since. */
  function raise(top: Element) {
    try {
      host!.hidePopover()
      host!.showPopover()
    } catch {}
    raisedOver = top
  }

  function setMode(next: number) {
    if (next === mode) return
    if ((next === 1) !== (mode === 1)) ghost!.style.display = next === 1 ? 'block' : 'none'
    if ((next === 2) !== (mode === 2)) flock!.style.display = next === 2 ? 'block' : 'none'
    mode = next
  }

  const put = (prop: string, value: string) => {
    if (written[prop] === value) return
    written[prop] = value
    ghost!.style.setProperty(prop, value)
  }

  const worn = () => `${written['outline-style']} ${written['outline-color']} ${written['box-shadow']}`

  /**
   * Dresses the single box as a ring. While it is hidden this takes effect at
   * once; while it is visible the change blends in.
   */
  function wear(ring: Ring) {
    if (!host) build()
    const o = ring.outline
    if (o) {
      put('outline-style', o[0])
      put('outline-width', o[1])
      put('outline-color', o[2])
      put('outline-offset', o[3])
    } else if (written['outline-style'] === 'auto') {
      // The colour of an `auto` outline is the browser's business.
      put('outline-style', 'none')
    } else {
      // Going from an outline to a shadow-only ring: outline-style cannot
      // transition, so fade the outline's colour out while the shadow fades in.
      put('outline-color', 'transparent')
    }
    put('box-shadow', ring.shadow || 'none')
    // A transparent border the same widths as the element's. Inset shadows
    // sit inside the border, and Chrome tucks `outline: auto` in over one, so
    // the ghost needs it to be painted the way the element is.
    put('border-width', ring.border)
  }

  /** Dresses the four quarters as the same ring, each with its own corner. */
  function dress(ring: Ring) {
    const set = (prop: string, value: string) => {
      if (dressed[prop] === value) return
      dressed[prop] = value
      for (const wing of wings) wing.style.setProperty(prop, value)
    }
    const o = ring.outline
    set('outline-style', o ? o[0] : 'none')
    if (o) {
      set('outline-width', o[1])
      set('outline-color', o[2])
      set('outline-offset', o[3])
    }
    set('box-shadow', ring.shadow || 'none')
    set('border-width', ring.border)
    for (let i = 0; i < 4; i++) {
      const radius = `${ring.radii[i]}px ${ring.radii[i + 4]}px`
      if (corners[i] === radius) continue
      corners[i] = radius
      wings[i]!.style.setProperty(CORNERS[i]!, radius)
    }
  }

  function active(): Element | null {
    let el = doc.activeElement
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
    return el === doc.body || el === doc.documentElement ? null : el
  }

  /**
   * One walk up from `el` for two answers. The element that wears the ring
   * when `el` has focus: `el` itself, or the nearest ancestor marked
   * `data-fring="within"` (an input group that shows its ring with
   * :focus-within), or nobody if `data-fring="off"` is anywhere above. And the
   * top-layer element it sits in, if any.
   */
  function survey(el: Element): { subject: Element | null; top: Element | null } {
    const fullscreen = doc.fullscreenElement
    let subject: Element | null = null
    let top: Element | null = null
    for (let node: Element | null = el; node; node = parent(node)) {
      const marked = node.getAttribute('data-fring')
      if (marked === 'off') return { subject: null, top: null }
      if (marked === 'within' && !subject) subject = node
      if (
        !top &&
        (node.localName === 'dialog' || node === fullscreen || node.hasAttribute('popover')) &&
        matches(node, TOP_LAYER)
      ) {
        top = node
      }
    }
    return { subject: subject ?? el, top }
  }

  /**
   * Jumps the element's own outline and box-shadow transitions to their end.
   * A ring that is still fading in when we read it would give us the wrong
   * style; one that fades in after the ghost lands would show a second ring.
   */
  function settle(el: Element) {
    for (const animation of el.getAnimations()) {
      const prop = (animation as CSSTransition).transitionProperty
      if (prop && (prop === 'box-shadow' || prop.startsWith('outline'))) {
        try {
          animation.finish()
        } catch {}
      }
    }
  }

  /**
   * Reads the ring focus put on `el`. `before` is what the element looked like
   * before focus, when we managed to see it; it lets a permanent outline or
   * shadow (a border drawn with `outline`, say) stay put during the flight.
   */
  function read(el: Element, before: Glimpse | null, top: Element | null): Ring | null {
    const box = el.getBoundingClientRect()
    if (!box.width && !box.height) return null

    const cs = win.getComputedStyle(el)
    const animated = running(cs.transitionDuration)
    if (animated) settle(el)

    const now: Outline = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset]
    let outline: Outline | null = now[0] !== 'none' && parseFloat(now[1]) > 0 ? now : null
    if (outline && before && before.outline!.join() === now.join()) outline = null

    const all = layers(cs.boxShadow)
    const was = before ? layers(before.shadow) : null
    const rings = all.filter((layer) => isRing(layer) && !was?.includes(layer))

    if (!outline && !rings.length) return null

    const shadow = rings.join(', ')
    const bareShadow = all.filter((layer) => !rings.includes(layer)).join(', ') || 'none'
    const fade = el.getClientRects().length > 1
    return {
      el,
      box,
      outline,
      shadow,
      restOutline: outline && (before ? before.outline : ['none', now[1], now[2], now[3]]),
      restShadow: rings.length ? (before ? before.shadow : bareShadow) : null,
      bareShadow,
      border: `${cs.borderTopWidth} ${cs.borderRightWidth} ${cs.borderBottomWidth} ${cs.borderLeftWidth}`,
      radii: radii(cs, box.width, box.height),
      extent: Math.max(
        outline ? Math.max(parseFloat(outline[3]) || 0, 0) + parseFloat(outline[1]) : 0,
        ...rings.map(reach),
      ),
      animated,
      fade,
      // Quarters of a dashed outline would not line up where they meet, and a
      // blurred shadow is cut off where one quarter ends. Those stay on one box.
      fast:
        !fade &&
        (!outline || /^(solid|double|auto)$/.test(outline[0])) &&
        rings.every((layer) => !lengths(layer)[2]),
      clips: null,
      top,
      key: `${outline ? outline.join() : ''}/${shadow}`,
    }
  }

  /**
   * The ancestors that will cut the ring off. Reading a style from every
   * ancestor is the most expensive thing fring does, so it waits until the
   * ghost is nearly there. A flight that is redirected first never pays for it.
   */
  function clippers(el: Element): Element[] {
    const out: Element[] = []
    for (let node: Element | null = el; node && node !== doc.body && node !== doc.documentElement; node = parent(node)) {
      if (node !== el && matches(node, TOP_LAYER)) break
      const cs = win.getComputedStyle(node)
      if (node !== el && /auto|scroll|hidden|clip/.test(cs.overflowX + cs.overflowY)) out.push(node)
      // Out-of-flow boxes can escape their ancestors' clipping. Guessing
      // wrong would cut the ring off in mid-air, so stop looking instead.
      if (cs.position === 'fixed' || cs.position === 'absolute') break
    }
    return out
  }

  /**
   * Holds the element's own ring back while the ghost flies to it. In the air
   * the element looks as it did before focus. `bare` then removes even that
   * (an outline used as a border would otherwise peek out from under the
   * ghost's edge on the final frame), and `thaw` gives everything back.
   */
  function freeze(ring: Ring): Hold | null {
    const el = ring.el as Element & ElementCSSInlineStyle
    const style = el.style
    if (!style) return null
    const hadAttribute = el.hasAttribute('style')
    const saved: [prop: string, value: string, priority: string][] = []
    const hold = (prop: string, value: string) => {
      saved.push([prop, style.getPropertyValue(prop), style.getPropertyPriority(prop)])
      style.setProperty(prop, value, 'important')
    }
    if (ring.restOutline) OUTLINE.forEach((prop, i) => hold(prop, ring.restOutline![i]!))
    if (ring.restShadow !== null) hold('box-shadow', ring.restShadow)
    if (ring.animated) settle(el)

    return {
      el,
      bare() {
        if (ring.restOutline) style.setProperty('outline-style', 'none', 'important')
        if (ring.restShadow !== null) style.setProperty('box-shadow', ring.bareShadow, 'important')
        if (ring.animated) settle(el)
      },
      thaw() {
        for (const [prop, value, priority] of saved) {
          if (value) style.setProperty(prop, value, priority)
          else style.removeProperty(prop)
        }
        if (!hadAttribute && !el.getAttribute('style')) el.removeAttribute('style')
        if (ring.animated && el.isConnected) settle(el)
      },
    }
  }

  function release() {
    held?.thaw()
    held = null
  }

  /** Where a ring that is on screen right now sits, if we can still tell. */
  function measure(ring: Ring): Box | null {
    if (ring.el.isConnected) {
      const rect = ring.el.getBoundingClientRect()
      if (rect.width || rect.height) return rect
    }
    // The element is gone (a closed dialog, a removed row). If nothing has
    // scrolled since the ring landed on it, where it landed is still right.
    return landedOn === ring.el ? landedAt : null
  }

  function place(box: Box, ring: Ring, grow = 0) {
    abs[0] = box.left - grow
    abs[1] = box.top - grow
    abs[2] = box.left + box.width + grow
    abs[3] = box.top + box.height + grow
    for (let i = 0; i < 8; i++) abs[4 + i] = ring.radii[i]!
  }

  /**
   * Sets up the springs for a flight from where the ghost is to `box`. The
   * further it has to go the longer it takes, and the edge facing the way it
   * is going leads.
   */
  function aim(box: Box, ring: Ring) {
    d[0] = abs[0]! - box.left
    d[1] = abs[1]! - box.top
    d[2] = abs[2]! - (box.left + box.width)
    d[3] = abs[3]! - (box.top + box.height)
    for (let i = 0; i < 8; i++) d[4 + i] = abs[4 + i]! - ring.radii[i]!

    // How far the centre has to travel, as ghost minus destination.
    const dx = (d[0]! + d[2]!) / 2
    const dy = (d[1]! + d[3]!) / 2
    const scale = Math.min(Math.max(0.82 + Math.hypot(dx, dy) / 1600, 0.82), 1.35) * duration
    springs = [
      spring(scale, bounce),
      spring(scale * LEAD, bounce),
      spring(scale * TRAIL, bounce),
      spring(scale * ROUND, 0),
    ]

    const role = (delta: number, towardNegative: boolean) =>
      Math.abs(delta) < DIRECTION ? 0 : delta > 0 === towardNegative ? 1 : 2
    // dx > 0 means the ghost is right of where it is going, so it travels
    // left and its left edge leads.
    rides[0] = role(dx, true)
    rides[2] = role(dx, false)
    rides[1] = role(dy, true)
    rides[3] = role(dy, false)
  }

  /** Works out where the ring should be now and starts whatever gets it there. */
  function sync(now: number) {
    const before = pending
    pending = null

    const el = reduced.matches ? null : active()
    const shows = !!el && matches(el, ':focus-visible')
    if (el === seen && shows === visible) return
    const flipped = shows !== visible
    seen = el
    visible = shows
    inShadow = !!el && el.getRootNode() !== doc

    // The walk up the tree was done as focus left the last element, if we saw it leave.
    const glimpse = before && before.for === el ? before : null
    const found = glimpse ?? (el ? survey(el) : null)
    const subject = found ? found.subject : null
    // Focus moving between two fields of one group leaves the group's ring alone.
    if (subject === wearer && !flipped) return
    wearer = subject

    const from = cur
    // Read everything before writing anything, so the browser works out
    // layout once for this focus change instead of once per question.
    if (held && held.el === subject) release()
    const ring = subject && read(subject, glimpse && glimpse.outline ? glimpse : null, found!.top)
    const start = !flying && from ? measure(from) : null
    release()
    // The element the ring is leaving may fade its own ring out with a CSS
    // transition. Left alone, that fading ring sits under the ghost as it
    // departs and there are two rings for a moment.
    if (from && from.animated && from.el !== subject && from.el.isConnected) settle(from.el)
    cur = ring
    arrived = false

    if (!ring) {
      // The ring is gone. Fade the ghost out where it is, or where the ring was.
      if (!flying) {
        if (!start) return
        wear(from!)
        if (!ensure()) return
        place(start, from!)
        opacity = 1
        flying = true
        last = now
      }
      dest = null
      opacityTo = 0
      return
    }

    let blend = false
    if (!flying) {
      if (start) {
        wear(from!)
        if (!ensure()) return
        place(start, from!)
        opacity = 1
        if (from!.key !== ring.key) {
          // Let the single box take on the old ring's look, on screen, before
          // it is given the new one. That is what makes the change a blend.
          setMode(1)
          void win.getComputedStyle(ghost!).outlineColor
          blend = true
        }
      } else {
        // Nothing to fly from: the ring settles in from slightly outside.
        if (ring.fade) return
        wear(ring)
        if (!ensure()) return
        place(ring.box, ring, GROW)
        opacity = 0
      }
      if (ring.top) raise(ring.top)
      v.fill(0)
      last = now
      wear(ring)
    } else {
      if (ring.top && ring.top !== raisedOver) raise(ring.top)
      const look = worn()
      wear(ring)
      blend = look !== worn()
    }
    if (blend) lookAt = now < 0 ? Infinity : now
    if (ring.fast) dress(ring)

    aim(ring.box, ring)
    dest = ring
    opacityTo = ring.fade ? 0 : 1
    if (!ring.fade) held = freeze(ring)
    flying = true
    // Holding the ring back changes how the element is painted, not where it
    // is, so this frame can use the box it has already measured.
    fresh = ring.box
  }

  function advance(now: number) {
    // A frame that does not know the time draws without moving. The frame
    // after it has nothing to measure from, so it moves by one usual frame.
    const known = now >= 0 && last >= 0
    const dt = now < 0 ? 0 : known ? (now - last) / 1000 : frame
    const stalled = dt > STALL
    if (known && dt > 0.003 && dt < 0.05) frame += (dt - frame) * 0.2
    if (now >= 0 && lookAt === Infinity) lookAt = now
    last = now

    let box: DOMRect | null = null
    if (dest) {
      box = fresh ?? (dest.el.isConnected ? dest.el.getBoundingClientRect() : null)
      if (!box || (!box.width && !box.height)) return land(null)
      // The previous frame drew the ghost exactly on the element. Swap.
      if (arrived) return land(box)
      if (stalled) {
        d.fill(0)
        v.fill(0)
      } else {
        for (const sp of springs) prime(sp, dt)
        for (let i = 0; i < N; i++) move(springs[rides[i]!]!, d, v, i)
      }
    }
    fresh = null
    opacity += (opacityTo - opacity) * (stalled ? 1 : 1 - Math.exp(-dt / FADE))

    if (dest) {
      let still = true
      for (let i = 0; i < N; i++) {
        if (Math.abs(d[i]!) > 0.4 || Math.abs(v[i]!) > 20) {
          still = false
          break
        }
      }
      if (dest.fade) {
        if (still || opacity < 0.01) return land(box)
      } else if (still && opacity > 0.99 && now - lookAt >= LOOK_MS + 34) {
        // Close enough that the eye cannot tell. Draw one frame exactly on
        // the element so the hand-off to its own ring changes no pixels.
        d.fill(0)
        v.fill(0)
        opacity = 1
        arrived = true
        held?.bare()
      }
      // The ghost is positioned relative to where the destination is now, so
      // scrolling or layout changes mid-flight carry it along for free.
      abs[0] = box!.left + d[0]!
      abs[1] = box!.top + d[1]!
      abs[2] = box!.right + d[2]!
      abs[3] = box!.bottom + d[3]!
      for (let i = 0; i < 8; i++) abs[4 + i] = dest.radii[i]! + d[4 + i]!
    } else if (opacity < 0.01) {
      return land(null)
    }

    paint(now, arrived ? box : null)
  }

  /**
   * Draws this frame, one of two ways.
   *
   * Moving the single box means changing its left, top, width and height, and
   * a browser answers that by laying out and repainting. In Chrome a repaint
   * walks the whole page's display list, so on a large page each frame of a
   * flight costs as much as the page is big.
   *
   * So for most of a flight the ring is drawn as four quarters instead, and
   * only their transforms change, which the compositor applies without any
   * layout or paint. The single box is kept for the frames that need it: while
   * the corners are still changing shape, while one look blends into another,
   * when something clips the ring, and for the last frame, which has to match
   * the browser's own ring to the pixel. Given `exact`, that is this frame.
   */
  function paint(now: number, exact: DOMRect | null) {
    // Both drawings carry the opacity, so switching between them shows nothing.
    const o = opacity > 0.995 ? '1' : opacity < 0.005 ? '0' : opacity.toFixed(3)
    if (o !== faded) {
      faded = o
      ghost!.style.opacity = o
      flock!.style.opacity = o
    }

    const near =
      !!dest && (!!exact || Math.abs(d[0]!) + Math.abs(d[1]!) + Math.abs(d[2]!) + Math.abs(d[3]!) < NEAR)
    if (near && dest!.clips === null) dest!.clips = clippers(dest!.el)
    const clipped = near && !dest!.fade && dest!.clips!.length > 0

    if (!exact && !clipped && dest?.fast && now - lookAt >= LOOK_MS + 34 && rounded() && compose(dest)) {
      return setMode(2)
    }

    const x = exact ? exact.left : abs[0]!
    const y = exact ? exact.top : abs[1]!
    const w = exact ? exact.width : Math.max(abs[2]! - x, 0)
    const h = exact ? exact.height : Math.max(abs[3]! - y, 0)
    // left/top rather than a transform, and no CSS containment on the box:
    // both change how a browser rounds a box to device pixels, and this box
    // has to round exactly as the real element does for the hand-off to be
    // invisible. The final frame is written at full precision for the same reason.
    const f = exact ? (n: number) => `${n}px` : px
    put('left', f(x))
    put('top', f(y))
    put('width', f(w))
    put('height', f(h))
    const r = (i: number) => f(Math.max(abs[4 + i]!, 0))
    put('border-radius', `${r(0)} ${r(1)} ${r(2)} ${r(3)}/${r(4)} ${r(5)} ${r(6)} ${r(7)}`)
    put('clip-path', clipped ? clip(x, y, w, h) : 'none')
    setMode(1)
  }

  /** The corners have finished changing shape. */
  function rounded(): boolean {
    for (let i = 4; i < N; i++) if (Math.abs(d[i]!) > 0.5) return false
    return true
  }

  /**
   * Draws the ring as four quarters. Each quarter is a clip box holding a big
   * box that wears the ring, pinned by one corner, so the clip shows that
   * corner and the two edges leading away from it. Four of them meet in the
   * middle and make the whole ring.
   *
   * Resizing a quarter is a scale on its clip box. The box inside is scaled
   * by the inverse, so it stays its real size and the ring is never stretched
   * or thinned. Nothing but transforms changes, which costs no layout and no
   * paint. Returns false if the ring is too big for the boxes.
   */
  function compose(ring: Ring): boolean {
    // Whole device pixels, so the ring is as crisp as a painted one and the
    // quarters meet without a seam.
    const dpr = win.devicePixelRatio || 1
    const snap = (n: number) => Math.round(n * dpr) / dpr
    const l = snap(abs[0]!)
    const t = snap(abs[1]!)
    const r = snap(abs[2]!)
    const b = snap(abs[3]!)
    const pad = Math.ceil(ring.extent) + 2
    if (r - l < 1 || b - t < 1 || Math.max(r - l, b - t) / 2 + pad > WING - 8) return false
    const cx = snap((l + r) / 2)
    const cy = snap((t + b) / 2)

    quarter(0, l - pad, t - pad, cx, cy, l, t)
    quarter(1, cx, t - pad, r + pad, cy, r - WING, t)
    quarter(2, cx, cy, r + pad, b + pad, r - WING, b - WING)
    quarter(3, l - pad, cy, cx, b + pad, l, b - WING)
    return true
  }

  /** Clips quarter `i` to the given rectangle, with its wing's corner box at (x, y). */
  function quarter(i: number, left: number, top: number, right: number, bottom: number, x: number, y: number) {
    const sx = (right - left) / CLIP
    const sy = (bottom - top) / CLIP
    const outer = `translate(${left}px,${top}px) scale(${sx},${sy})`
    if (moved[i * 2] !== outer) {
      moved[i * 2] = outer
      quarters[i]!.style.transform = outer
    }
    const inner = `scale(${1 / sx},${1 / sy}) translate(${x - left}px,${y - top}px)`
    if (moved[i * 2 + 1] !== inner) {
      moved[i * 2 + 1] = inner
      wings[i]!.style.transform = inner
    }
  }

  /**
   * If the destination's ring is cut off by a scroll container, the ghost has
   * to arrive cut off the same way. The cut is loose while the ghost is far
   * away and tightens to exact as it arrives, so it never clips in mid-air.
   */
  function clip(x: number, y: number, w: number, h: number): string {
    let left = -Infinity
    let top = -Infinity
    let right = Infinity
    let bottom = Infinity
    for (const el of dest!.clips!) {
      const rect = el.getBoundingClientRect()
      const l = rect.left + el.clientLeft
      const t = rect.top + el.clientTop
      left = Math.max(left, l)
      top = Math.max(top, t)
      right = Math.min(right, l + el.clientWidth)
      bottom = Math.min(bottom, t + el.clientHeight)
    }
    // Browsers round an overflow clip to device pixels.
    const dpr = win.devicePixelRatio || 1
    const snap = (n: number) => Math.round(n * dpr) / dpr
    const slack = (Math.abs(d[0]!) + Math.abs(d[1]!) + Math.abs(d[2]!) + Math.abs(d[3]!)) * 2
    const edge = -(dest!.extent + 1)
    const t = snap(top) - slack - y
    const r = x + w - snap(right) - slack
    const b = y + h - snap(bottom) - slack
    const l = snap(left) - slack - x
    if (t <= edge && r <= edge && b <= edge && l <= edge) return 'none'
    // Never clip further out than the ring reaches; huge negative insets are pointless.
    const inset = (n: number) => px(Math.max(n, edge))
    return `inset(${inset(t)} ${inset(r)} ${inset(b)} ${inset(l)})`
  }

  function land(box: DOMRect | null) {
    landedOn = box && dest ? dest.el : null
    landedAt = box
    // Same frame: the element's own ring comes back as the ghost goes away.
    release()
    setMode(0)
    flying = false
    arrived = false
    dest = null
    fresh = null
    v.fill(0)
  }

  /** One frame. `now` is the frame's time, or -1 when the caller cannot know it. */
  function tick(now: number) {
    raf = 0
    // Focus can move without an event (a focused element is removed or disabled).
    if (flying && dest && active() !== seen) dirty = true
    if (dirty) {
      dirty = false
      sync(now)
    }
    if (flying) {
      advance(now)
      if (flying) raf = win.requestAnimationFrame(tick)
    }
  }

  /**
   * Wakes fring up, in time to act before this frame is painted.
   *
   * The obvious way is requestAnimationFrame. But a frame requested while the
   * browser is handling a key press or a click belongs, as far as Chrome is
   * concerned, to that interaction, and so does every frame requested from
   * it. Chrome watches what an interaction changes on the page so it can time
   * when those changes appear (it is how it detects in-page navigations), and
   * the watching forces a repaint of the page on every frame fring moves
   * something. On a large page that costs more than everything else fring
   * does put together.
   *
   * A ResizeObserver callback is not part of any interaction. So fring flips
   * the width of an element nobody can see, and the browser calls back later
   * in the same frame, after layout and before paint. Frames requested from
   * there are free of the watching.
   */
  function poke() {
    dirty = true
    // Already awake, or already rung and waiting for the answer. (If the host
    // has been taken off the page since, no answer is coming: ring again.)
    if (raf || (rung && host!.isConnected)) return
    // Reduced motion never draws anything, so it needs no element to ring.
    if (!reduced.matches && ensure()) {
      rung = true
      ringing = !ringing
      bell!.style.width = ringing ? '1px' : '0'
    } else {
      raf = win.requestAnimationFrame(tick)
    }
  }

  function answer() {
    rung = false
    if (!raf && (dirty || flying)) tick(-1)
  }

  /** Take a look at an element just before it takes focus. */
  function remember(el: Element) {
    if (reduced.matches) return
    const { subject, top } = survey(el)
    let outline: Outline | null = null
    let shadow = ''
    if (subject && !matches(subject, ':focus-within')) {
      const cs = win.getComputedStyle(subject)
      outline = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset]
      shadow = cs.boxShadow
    }
    pending = { for: el, subject, top, outline, shadow }
  }

  function onFocusOut(event: Event) {
    const next = (event as FocusEvent).relatedTarget as Element | null
    if (next && next.nodeType === 1) remember(next)
    poke()
  }

  function onPointerDown(event: Event) {
    for (const node of event.composedPath() as Element[]) {
      if (node.nodeType === 1 && matches(node, FOCUSABLE)) {
        remember(node)
        break
      }
    }
  }

  /**
   * Focus events miss two things. A key press can turn :focus-visible on for
   * an element that already has focus, and focus moving inside one shadow root
   * never reaches the document. Typing in a field that already shows its ring
   * is neither, so it costs nothing.
   */
  function onKeyDown() {
    if (!visible || inShadow) poke()
  }

  function onClick() {
    if (inShadow) poke()
  }

  /** Anything that moves the page makes the remembered landing spot wrong. */
  function onMove() {
    landedOn = null
  }

  const offs: (() => void)[] = []
  const on = (target: EventTarget, type: string, listener: EventListener) => {
    const options = { capture: true, passive: true }
    target.addEventListener(type, listener, options)
    offs.push(() => target.removeEventListener(type, listener, options))
  }
  on(doc, 'focusin', poke)
  on(doc, 'focusout', onFocusOut)
  on(doc, 'pointerdown', onPointerDown)
  on(doc, 'keydown', onKeyDown)
  on(doc, 'click', onClick)
  on(doc, 'scroll', onMove)
  on(win, 'resize', onMove)
  on(win, 'focus', poke)
  on(win, 'blur', poke)
  on(reduced, 'change', poke)

  // Something may already be focused (autofocus, a restored tab). Nothing is
  // being interacted with yet, and nothing has been added to the page, so
  // this once an ordinary frame will do.
  dirty = true
  raf = win.requestAnimationFrame(tick)

  return {
    users: 0,
    configure(options) {
      duration = options.duration ?? 250
      bounce = options.bounce ?? 0.1
    },
    destroy() {
      for (const off of offs) off()
      if (raf) win.cancelAnimationFrame(raf)
      observer?.disconnect()
      release()
      try {
        if (host?.matches(':popover-open')) host.hidePopover()
      } catch {}
      host?.remove()
      host = ghost = flock = bell = observer = null
      quarters = []
      wings = []
    },
  }
}

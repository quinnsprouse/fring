import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Fring } from 'fring/react'
import { Install, Morph, Switch, Tabs, type Tab } from './controls'
import { type Accent } from './Swatches'
import { Tiles } from './Tiles'

export function App() {
  const [enabled, setEnabled] = useState(true)
  const [accent, setAccent] = useState<Accent>('Iris')
  const tiles = useRef<HTMLDivElement>(null)
  const tour = useTour(tiles)
  const tabDown = useKeyDown('Tab')
  const travelled = useTravelled()

  useEffect(() => {
    document.documentElement.dataset.accent = accent.toLowerCase()
  }, [accent])

  return (
    <>
      {enabled && <Fring />}

      <main>
        <header className="rise">
          <h1>
            <span className="mark" aria-hidden="true" />
            fring
          </h1>
          <p>Your focus ring, in motion.</p>
        </header>

        <div className="try rise" style={{ '--i': 1 } as CSSProperties}>
          <p>
            Press <kbd data-down={tabDown || undefined}>Tab</kbd>, or{' '}
            <button
              className="link"
              type="button"
              aria-label={tour.playing ? 'stop the tour' : 'watch a tour'}
              onClick={tour.toggle}
            >
              <Morph>{tour.playing ? 'stop the tour' : 'watch a tour'}</Morph>
            </button>
            .
          </p>
          <Switch label="fring" checked={enabled} onChange={setEnabled} />
        </div>

        <Tiles ref={tiles} accent={accent} onAccent={setAccent} />

        <section aria-labelledby="install">
          <h2 id="install">Install</h2>
          <Install />
        </section>

        <section aria-labelledby="usage">
          <h2 id="usage">Usage</h2>
          <Tabs tabs={SNIPPETS} label="Framework" />
          <p className="note">
            It animates the focus ring your CSS already draws, <code>outline</code> or <code>box-shadow</code>, so there
            is nothing to restyle.
          </p>
        </section>
      </main>

      <footer>
        <p>v0.1.0 · MIT · 5.9 kB</p>
        <p>
          <Morph>{travelled}</Morph>
        </p>
      </footer>
    </>
  )
}

/** True while the given key is held, so the page can press its own picture of it. */
function useKeyDown(key: string) {
  const [down, setDown] = useState(false)
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.key === key) setDown(true)
    }
    const release = () => setDown(false)
    window.addEventListener('keydown', press)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', press)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', release)
    }
  }, [key])
  return down
}

/** How far focus has moved on this page, for the footer. */
function useTravelled() {
  const [px, setPx] = useState(0)
  useEffect(() => {
    let last: { x: number; y: number } | null = null
    const onFocus = (event: FocusEvent) => {
      const rect = (event.target as Element).getBoundingClientRect()
      const at = { x: rect.left + rect.width / 2 + window.scrollX, y: rect.top + rect.height / 2 + window.scrollY }
      if (last) {
        const hop = Math.hypot(at.x - last.x, at.y - last.y)
        setPx((total) => total + hop)
      }
      last = at
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  if (px < 1) return 'Focus has not moved yet.'
  // A CSS pixel is 1/96 of an inch.
  const metres = (px / 96) * 0.0254
  const real = metres < 1 ? `${Math.round(metres * 100)} cm` : `${metres.toFixed(1)} m`
  return `Focus has travelled ${Math.round(px).toLocaleString('en')} px, about ${real}.`
}

/** Moves real focus through the tiles for people without a keyboard to hand. */
function useTour(tiles: RefObject<HTMLDivElement | null>) {
  const [playing, setPlaying] = useState(false)
  const origin = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!playing) return
    const stops = [...(tiles.current?.querySelectorAll<HTMLElement>('button, input') ?? [])].filter(
      (el) => el.tabIndex >= 0,
    )
    tiles.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    let index = 0
    const next = () => {
      const stop = stops[index++]
      if (!stop) return setPlaying(false)
      stop.focus({ preventScroll: true })
    }
    const first = window.setTimeout(next, 350)
    const timer = window.setInterval(next, 560)
    // Any real input from the person ends the tour and leaves focus where they put it.
    const cancel = (event: Event) => {
      if (event.isTrusted) {
        origin.current = null
        setPlaying(false)
      }
    }
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('pointerdown', cancel, true)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.removeEventListener('keydown', cancel, true)
      window.removeEventListener('pointerdown', cancel, true)
      origin.current?.focus({ preventScroll: true })
    }
  }, [playing, tiles])

  const toggle = useCallback(() => {
    origin.current = document.activeElement as HTMLElement | null
    setPlaying((value) => !value)
  }, [])

  return { playing, toggle }
}

function K({ children }: { children: ReactNode }) {
  return <span className="k">{children}</span>
}
function S({ children }: { children: ReactNode }) {
  return <span className="s">{children}</span>
}

const SNIPPETS: Tab[] = [
  {
    name: 'React',
    text: "import { Fring } from 'fring/react'\n\n<Fring />",
    content: (
      <>
        <K>import</K> {'{ Fring }'} <K>from</K> <S>'fring/react'</S>
        {'\n\n<Fring />'}
      </>
    ),
  },
  {
    name: 'Anything else',
    text: "import { fring } from 'fring'\n\nconst stop = fring()",
    content: (
      <>
        <K>import</K> {'{ fring }'} <K>from</K> <S>'fring'</S>
        {'\n\n'}
        <K>const</K> stop = fring()
      </>
    ),
  },
  {
    name: 'Script tag',
    text: '<script src="https://unpkg.com/fring" defer></script>',
    content: (
      <>
        {'<script '}
        <K>src</K>=<S>"https://unpkg.com/fring"</S> <K>defer</K>
        {'></script>'}
      </>
    ),
  },
]

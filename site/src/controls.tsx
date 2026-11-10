import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { TextMorph } from 'torph/react'

/** The spring every moving part of the page shares, as a CSS easing. */
const SPRING =
  'linear(0, 0.001 0.5%, 0.006 1.5%, 0.02 2.8%, 0.047 4.4%, 0.088 6.4%, 0.143 8.5%, 0.211 10.9%, 0.29 13.5%, 0.375 16.3%, 0.463 19.3%, 0.551 22.4%, 0.634 25.8%, 0.71 29.3%, 0.777 33%, 0.835 36.8%, 0.882 40.8%, 0.92 45%, 0.949 49.3%, 0.97 53.8%, 0.985 58.4%, 0.994 63.1%, 1 68%, 1.004 73%, 1.005 78.1%, 1.005 83.4%, 1.004 88.8%, 1.004 94.3%, 1)'

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Text that changes by keeping the letters both versions share and moving
 * them, instead of swapping one word for another. This is torph.
 */
export function Morph({ children, className }: { children: string; className?: string }) {
  return (
    <TextMorph as="span" className={className} duration={380} ease="cubic-bezier(0.19, 1, 0.22, 1)">
      {children}
    </TextMorph>
  )
}

/**
 * Slides one highlight between the items of a group instead of switching it
 * off in one place and on in another. Returns a ref for the group; the group
 * draws the highlight from the --thumb-x and --thumb-w it is given.
 */
function useThumb(index: number) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const place = () => {
      const item = root.querySelectorAll<HTMLElement>('[data-item]')[index]
      if (!item) return
      root.style.setProperty('--thumb-x', `${item.offsetLeft}px`)
      root.style.setProperty('--thumb-w', `${item.offsetWidth}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(root)
    // The first placement must not animate in from the corner.
    const frame = requestAnimationFrame(() => root.setAttribute('data-ready', ''))
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [index])
  return ref
}

/** A radio group. One tab stop, arrow keys move within it. */
export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: string[]
  value: string
  onChange: (value: string) => void
  label: string
}) {
  const index = options.indexOf(value)
  const root = useThumb(index)
  const move = (event: KeyboardEvent, from: number) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!delta) return
    event.preventDefault()
    const next = (from + delta + options.length) % options.length
    onChange(options[next]!)
    root.current?.querySelectorAll<HTMLElement>('[data-item]')[next]?.focus()
  }
  return (
    <div className="segmented thumbed" role="radiogroup" aria-label={label} ref={root}>
      {options.map((option, i) => (
        <button
          key={option}
          data-item
          type="button"
          role="radio"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(event) => move(event, i)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="switch">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
        <span />
      </button>
      {label}
    </label>
  )
}

/** A quiet Copy that becomes Copied for a moment. */
export function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      className="copy"
      type="button"
      aria-label={copied ? 'Copied' : `Copy ${what}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => {},
        )
      }}
    >
      <Morph>{copied ? 'Copied' : 'Copy'}</Morph>
    </button>
  )
}

const MANAGERS = {
  npm: 'npm i fring',
  pnpm: 'pnpm add fring',
  yarn: 'yarn add fring',
  bun: 'bun add fring',
} as const

/** The install command. Choosing a package manager rewrites it in place. */
export function Install() {
  const [manager, setManager] = useState<keyof typeof MANAGERS>('npm')
  return (
    <div className="install">
      <div className="managers" role="group" aria-label="Package manager">
        {(Object.keys(MANAGERS) as (keyof typeof MANAGERS)[]).map((name) => (
          <button key={name} type="button" aria-pressed={name === manager} onClick={() => setManager(name)}>
            {name}
          </button>
        ))}
      </div>
      <div className="code">
        <code>
          <span className="dim">$ </span>
          <Morph>{MANAGERS[manager]}</Morph>
        </code>
        <CopyButton text={MANAGERS[manager]} what="the install command" />
      </div>
    </div>
  )
}

export interface Tab {
  name: string
  /** The code as plain text, for copying. */
  text: string
  content: ReactNode
}

/**
 * Tabs. One tab stop, arrow keys move between them. The highlight slides to
 * the chosen tab, the code comes in from the side that tab is on, and the
 * block grows or shrinks to fit instead of jumping.
 */
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [leaving, setLeaving] = useState<number | null>(null)
  const list = useThumb(index)
  const panel = useRef<HTMLPreElement>(null)
  const height = useRef(0)
  const id = useId()

  const select = (next: number) => {
    if (next === index) return
    setDirection(next > index ? 1 : -1)
    setLeaving(index)
    setIndex(next)
  }

  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const next = el.offsetHeight
    if (height.current && height.current !== next && !reducedMotion()) {
      el.animate([{ height: `${height.current}px` }, { height: `${next}px` }], { duration: 420, easing: SPRING })
    }
    height.current = next
  }, [index])

  const move = (event: KeyboardEvent) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!delta) return
    event.preventDefault()
    const next = (index + delta + tabs.length) % tabs.length
    select(next)
    list.current?.querySelectorAll<HTMLElement>('[data-item]')[next]?.focus()
  }

  return (
    <div className="tabbed">
      <div className="tabs thumbed" role="tablist" aria-label={label} ref={list}>
        {tabs.map((tab, i) => (
          <button
            key={tab.name}
            data-item
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === index}
            aria-controls={`${id}-panel`}
            tabIndex={i === index ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={move}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="code">
        <pre
          ref={panel}
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          style={{ '--direction': direction } as CSSProperties}
        >
          {leaving !== null && (
            <code
              key={`out-${leaving}`}
              className="slide-out"
              aria-hidden="true"
              onAnimationEnd={() => setLeaving(null)}
            >
              {tabs[leaving]!.content}
            </code>
          )}
          <code key={index} className={leaving === null ? undefined : 'slide-in'}>
            {tabs[index]!.content}
          </code>
        </pre>
        <CopyButton text={tabs[index]!.text} what="the code" />
      </div>
    </div>
  )
}

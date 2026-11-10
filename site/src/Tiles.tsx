import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { Morph, Segmented, Switch } from './controls'
import { Swatches, type Accent } from './Swatches'

/**
 * Four small scenes, each with a different kind of thing to focus: tiny
 * squares, wide fields, a control that moves with the arrow keys, and odd
 * shapes. Tab runs through all of them in order, so the grid is one long
 * flight path.
 */
export function Tiles({
  ref,
  accent,
  onAccent,
}: {
  ref: Ref<HTMLDivElement>
  accent: Accent
  onAccent: (accent: Accent) => void
}) {
  return (
    <div className="tiles" ref={ref}>
      <Tile index={0}>
        <Toolbar />
      </Tile>
      <Tile index={1}>
        <Invite />
      </Tile>
      <Tile index={2}>
        <Choices />
      </Tile>
      <Tile index={3}>
        <Swatches value={accent} onChange={onAccent} />
      </Tile>
    </div>
  )
}

function Tile({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="tile rise" style={{ '--i': index + 2 } as CSSProperties}>
      {children}
    </div>
  )
}

const FORMATS = [
  { name: 'Bold', glyph: 'B', style: { fontWeight: 700 } },
  { name: 'Italic', glyph: 'I', style: { fontStyle: 'italic' } },
  { name: 'Underline', glyph: 'U', style: { textDecorationLine: 'underline' } },
  { name: 'Strikethrough', glyph: 'S', style: { textDecorationLine: 'line-through' } },
] as const

/** Small squares, close together. The shortest hops on the page. */
function Toolbar() {
  const [on, setOn] = useState<Record<string, boolean>>({ Bold: true })
  const lines = FORMATS.filter((format) => on[format.name] && 'textDecorationLine' in format.style)
    .map((format) => (format.style as { textDecorationLine: string }).textDecorationLine)
    .join(' ')
  return (
    <div className="scene">
      <p
        className="sample"
        style={{
          fontWeight: on.Bold ? 700 : 500,
          fontStyle: on.Italic ? 'italic' : 'normal',
          textDecorationLine: lines || 'none',
        }}
      >
        Focus
      </p>
      <div className="toolbar" role="group" aria-label="Formatting">
        {FORMATS.map((format) => (
          <button
            key={format.name}
            type="button"
            aria-label={format.name}
            aria-pressed={!!on[format.name]}
            style={format.style}
            onClick={() => setOn({ ...on, [format.name]: !on[format.name] })}
          >
            {format.glyph}
          </button>
        ))}
        <span className="rule" aria-hidden="true" />
        <button type="button" aria-label="Link">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.6.6M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.6-.6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

const STEPS = ['Continue', 'Confirm', 'Done'] as const

/** Wide fields and a pill. One field has an outline ring, the other a box-shadow one. */
function Invite() {
  const [step, setStep] = useState(0)
  // Done does not stay done. It is a demo.
  useEffect(() => {
    if (step === 0) return
    const timer = window.setTimeout(() => setStep(0), step === 2 ? 1600 : 4000)
    return () => window.clearTimeout(timer)
  }, [step])
  return (
    <form className="scene invite" onSubmit={(event) => event.preventDefault()}>
      <input aria-label="Email" placeholder="you@example.com" autoComplete="off" spellCheck={false} />
      <input className="shadow-ring" aria-label="Invite code" placeholder="Invite code" autoComplete="off" />
      <button
        className="primary"
        type="submit"
        aria-label={STEPS[step]}
        onClick={() => setStep((current) => (current + 1) % STEPS.length)}
      >
        <Morph>{STEPS[step]!}</Morph>
      </button>
    </form>
  )
}

/** A control with one tab stop and arrow keys inside it, then two small targets. */
function Choices() {
  const [notify, setNotify] = useState('Mentions')
  const [weekly, setWeekly] = useState(true)
  const [quiet, setQuiet] = useState(false)
  return (
    <div className="scene choices">
      <Segmented label="Notify me" options={['Always', 'Mentions', 'Never']} value={notify} onChange={setNotify} />
      <label className="check">
        <input type="checkbox" checked={weekly} onChange={(event) => setWeekly(event.target.checked)} />
        Weekly summary
      </label>
      <Switch label="Quiet hours" checked={quiet} onChange={setQuiet} />
    </div>
  )
}

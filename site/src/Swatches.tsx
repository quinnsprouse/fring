import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from './controls'

export const ACCENTS = ['Iris', 'Ember', 'Moss', 'Rose', 'Ink'] as const
export type Accent = (typeof ACCENTS)[number]

/**
 * The ring's colour, as five buttons of five shapes.
 *
 * Until the visitor does something, a stand-in ring wanders across them to
 * show what the page is about. It is a picture of a focus ring, not focus: it
 * moves nothing and announces nothing. The first key press or click retires
 * it for good, and from then on the only ring on the page is the real one.
 */
export function Swatches({ value, onChange }: { value: Accent; onChange: (accent: Accent) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLSpanElement>(null)
  const [retired, setRetired] = useState(false)

  useEffect(() => {
    const retire = () => setRetired(true)
    window.addEventListener('keydown', retire, { once: true, capture: true })
    window.addEventListener('pointerdown', retire, { once: true, capture: true })
    return () => {
      window.removeEventListener('keydown', retire, true)
      window.removeEventListener('pointerdown', retire, true)
    }
  }, [])

  useEffect(() => {
    const group = root.current
    const el = ring.current
    if (!group || !el || retired || reducedMotion()) return
    const shapes = [...group.querySelectorAll<HTMLElement>('[data-shape]')]
    const order = [0, 1, 2, 3, 4, 2, 0]
    let step = 0
    let from = -1

    const hop = () => {
      const to = order[step++ % order.length]!
      const shape = shapes[to]!
      const gap = 4
      const forward = to > from
      // Like the real thing: the edge facing the way it is going moves first.
      el.style.setProperty('--left-ms', forward ? '520ms' : '380ms')
      el.style.setProperty('--right-ms', forward ? '380ms' : '520ms')
      el.style.left = `${shape.offsetLeft - gap}px`
      el.style.right = `${group.clientWidth - shape.offsetLeft - shape.offsetWidth - gap}px`
      el.style.top = `${shape.offsetTop - gap}px`
      el.style.bottom = `${group.clientHeight - shape.offsetTop - shape.offsetHeight - gap}px`
      // Each corner follows the shape's own, pushed out by the gap.
      const cs = getComputedStyle(shape)
      const half = shape.offsetHeight / 2
      el.style.borderRadius = [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ]
        .map((corner) => `${Math.min(parseFloat(corner), half) + gap}px`)
        .join(' ')
      el.dataset.on = ''
      from = to
    }

    const first = window.setTimeout(hop, 700)
    const timer = window.setInterval(hop, 1500)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      delete el.dataset.on
    }
  }, [retired])

  return (
    <div className="swatches" role="group" aria-label="Ring colour" ref={root}>
      {ACCENTS.map((accent) => (
        <button
          key={accent}
          type="button"
          data-shape
          data-accent={accent}
          aria-label={accent}
          aria-pressed={accent === value}
          title={accent}
          onClick={() => onChange(accent)}
        />
      ))}
      <span className="stand-in" aria-hidden="true" ref={ring} />
    </div>
  )
}

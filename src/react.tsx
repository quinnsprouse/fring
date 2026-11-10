import { useEffect } from 'react'
import { fring, type FringOptions } from 'fring'

export type FringProps = Pick<FringOptions, 'duration' | 'bounce'>

/**
 * Animates the focus ring for the whole document. Render it once, anywhere;
 * it draws nothing in the React tree.
 *
 * ```tsx
 * <Fring />
 * ```
 */
export function Fring({ duration, bounce }: FringProps): null {
  useEffect(() => fring({ duration, bounce }), [duration, bounce])
  return null
}

/** The hook behind `<Fring />`, for when a component is in the way. */
export function useFring({ duration, bounce }: FringProps = {}): void {
  useEffect(() => fring({ duration, bounce }), [duration, bounce])
}

export type { FringOptions }

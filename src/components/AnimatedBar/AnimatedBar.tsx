import { useEffect, useRef, useState } from 'react'
import styles from './AnimatedBar.module.css'

const DURATION_MS = 850

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * `delay` only applies to the first animation (the cascade when the card
 * appears). Later value changes start right away so the UI responds instantly.
 */
function useFirstRunDelay(delay: number): number {
  const [firstRun, setFirstRun] = useState(true)
  useEffect(() => {
    const id = setTimeout(() => setFirstRun(false), delay + DURATION_MS)
    return () => clearTimeout(id)
  }, [delay])
  return firstRun ? delay : 0
}

interface BarFillProps {
  /** Target width, 0–100 (%). */
  width: number
  color: string
  /** Positioning class from the caller (anchor left/right, radius, opacity). */
  className?: string
  /** Stagger for the cascade, in ms. */
  delay?: number
}

/**
 * Bar fill that grows from 0 on mount with a spring overshoot, and slides to
 * the new width whenever `width` changes.
 */
export function BarFill({ width, color, className, delay = 0 }: BarFillProps) {
  const reduced = prefersReducedMotion()
  const [shown, setShown] = useState(reduced ? width : 0)
  const activeDelay = useFirstRunDelay(delay)

  useEffect(() => {
    // Next frame, so the browser paints the starting width before transitioning.
    const id = requestAnimationFrame(() => setShown(width))
    return () => cancelAnimationFrame(id)
  }, [width])

  return (
    <div
      className={[className, styles.fill].filter(Boolean).join(' ')}
      style={{ width: `${shown}%`, background: color, transitionDelay: `${activeDelay}ms` }}
    />
  )
}

interface CountUpProps {
  /** Number or formatted text ("144", "4.54"). Anything non-numeric ("—") is shown as is. */
  value: number | string | null | undefined
  delay?: number
}

/**
 * Number that counts up from 0 in sync with its bar, and from the old value to
 * the new one when it changes. Keeps the decimals of the formatted text.
 */
export function CountUp({ value, delay = 0 }: CountUpProps) {
  const text = value == null ? '—' : String(value)
  const target = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null
  const decimals = target == null ? 0 : (text.split('.')[1]?.length ?? 0)

  const reduced = prefersReducedMotion()
  const [shown, setShown] = useState(reduced || target == null ? target : 0)
  const fromRef = useRef(shown ?? 0)
  const activeDelay = useFirstRunDelay(delay)

  useEffect(() => {
    if (target == null || reduced) {
      setShown(target)
      fromRef.current = target ?? 0
      return
    }
    const from = fromRef.current
    let frame = 0
    const start = performance.now() + activeDelay
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / DURATION_MS))
      const eased = 1 - Math.pow(1 - p, 3)
      const v = from + (target - from) * eased
      setShown(v)
      fromRef.current = v
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // activeDelay is read on purpose only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduced])

  return <>{target == null || shown == null ? text : shown.toFixed(decimals)}</>
}

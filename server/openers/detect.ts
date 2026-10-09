// Is a probable starter really an opener? (pure, no I/O)
//
// An opener starts the game but only covers an inning or two before the bulk
// of the pitching. We tell from how the pitcher has been used, not from one
// short outing (an injury or a bad start isn't a pattern):
//   A) at least 3 of their last 5 starts were 6 outs (2 IP) or fewer, or
//   B) they're a reliever — 60%+ of their last 10 games (at least 3) in
//      relief — who goes 2 innings or less on average, and has opened before
//      (or is a true one-inning arm, 1.5 IP or less): a reliever's first start
//      is often a spot start, not an opener.
// Never if their latest start already went 3+ innings or 50+ pitches: they're
// being stretched out (moving into the rotation, back from the IL).
// A pitcher without history (debut, call-up) counts as a starter.
// On 2026 (scripts/db/validate-openers.ts): 84% of the flagged starters went
// 6 outs or fewer and 95% 3 innings or fewer; 67% of the opener games were
// flagged — most misses are pitchers with almost no appearances that season.

export interface Appearance {
  isStart: boolean
  outs: number
  pitches?: number
}

export type PitcherRole = 'starter' | 'opener'

export interface RoleInfo {
  role: PitcherRole
  apps: number          // appearances looked at (up to 10)
  reliefApps: number
  starts: number        // starts among the last 5
  shortStarts: number   // of those, 6 outs or fewer
  avgOuts: number | null
}

export const OPENER_MAX_OUTS = 6
const RECENT_APPS = 10
const RECENT_STARTS = 5
const STRETCHED_PITCHES = 50

/** `history` = the pitcher's appearances, newest first. */
export function classifyPitcher(history: Appearance[]): RoleInfo {
  const recent = history.slice(0, RECENT_APPS)
  const starts = history.filter(a => a.isStart).slice(0, RECENT_STARTS)
  const shortStarts = starts.filter(a => a.outs <= OPENER_MAX_OUTS).length
  const reliefApps = recent.filter(a => !a.isStart).length
  const avgOuts = recent.length ? recent.reduce((s, a) => s + a.outs, 0) / recent.length : null

  // Being stretched out: the latest start already went 3+ innings or 50+
  // pitches (a reliever moving into the rotation, a starter back from the IL).
  const lastStart = starts[0]
  const stretchedOut = lastStart != null && (lastStart.outs >= 9 || (lastStart.pitches ?? 0) >= STRETCHED_PITCHES)

  const patternOfShortStarts = shortStarts >= 3
  const shortReliever = recent.length >= 3 && reliefApps / recent.length >= 0.6 && avgOuts != null && avgOuts <= OPENER_MAX_OUTS
    && (shortStarts >= 1 || avgOuts <= 4.5)

  return {
    role: (patternOfShortStarts || shortReliever) && !stretchedOut ? 'opener' : 'starter',
    apps: recent.length,
    reliefApps,
    starts: starts.length,
    shortStarts,
    avgOuts: avgOuts == null ? null : Math.round(avgOuts * 10) / 10,
  }
}

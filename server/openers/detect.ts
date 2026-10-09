// Is a probable starter really an opener? (pure, no I/O)
//
// An opener starts the game but only covers an inning or two before the bulk
// of the pitching. We tell from how the pitcher has been used, not from one
// short outing (an injury or a bad start isn't a pattern):
//   A) at least 3 of their last 5 starts were 6 outs (2 IP) or fewer, or
//   B) they're a reliever — 60%+ of their last 10 games (at least 3) in
//      relief — who goes 2 innings or less on average.
// A pitcher without history (debut, call-up) counts as a starter.
// On 2026 (scripts/db/validate-openers.ts): 75% of the flagged starters went
// 6 outs or fewer, and 75% of the opener games were flagged; most misses are
// pitchers with almost no appearances that season.

export interface Appearance {
  isStart: boolean
  outs: number
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

/** `history` = the pitcher's appearances, newest first. */
export function classifyPitcher(history: Appearance[]): RoleInfo {
  const recent = history.slice(0, RECENT_APPS)
  const starts = history.filter(a => a.isStart).slice(0, RECENT_STARTS)
  const shortStarts = starts.filter(a => a.outs <= OPENER_MAX_OUTS).length
  const reliefApps = recent.filter(a => !a.isStart).length
  const avgOuts = recent.length ? recent.reduce((s, a) => s + a.outs, 0) / recent.length : null

  const patternOfShortStarts = shortStarts >= 3
  const shortReliever = recent.length >= 3 && reliefApps / recent.length >= 0.6 && avgOuts != null && avgOuts <= OPENER_MAX_OUTS

  return {
    role: patternOfShortStarts || shortReliever ? 'opener' : 'starter',
    apps: recent.length,
    reliefApps,
    starts: starts.length,
    shortStarts,
    avgOuts: avgOuts == null ? null : Math.round(avgOuts * 10) / 10,
  }
}

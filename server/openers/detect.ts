// Is a probable starter really an opener? (pure, no I/O)
//
// An opener starts the game but only covers an inning or two before the bulk
// of the pitching. We tell from how the pitcher has been used, not from one
// short outing (an injury or a bad start isn't a pattern):
//   A) at least 3 of their last 5 starts were 6 outs (2 IP) or fewer, or
//   B) they're a reliever — 60%+ of their last 10 games (at least 3) in
//      relief — who goes 2 innings or less on average, and has opened before,
//      is a one-inning arm (1.5 IP or less) or never goes past 2 IP in relief:
//      otherwise a reliever's first start is often a spot start, not an opener.
//      Looser on teams that use openers (3+ of their last 30 games): 2
//      appearances and half of them in relief are enough, first start or not.
//      (Tiers — 3-5 vs 6+ — were tried: they lost true openers, no gain.)
// Never if their latest start already went past 3 innings or 55+ pitches: they're
// being stretched out (moving into the rotation, back from the IL).
// A pitcher without history (debut, call-up) counts as a starter.
// Backtest (scripts/db/validate-openers.ts; each start classified only with
// earlier games, against a label from the pitcher's role within ±30 days):
//   2026 (rules tuned on it), team context carried from 2025: precision 95%,
//     recall 79%, 0.24% of traditional starts flagged; April 97% / 85%.
//   2025 (out of sample): precision 86%, recall 74%, 0.36% flagged.
// 95% of flagged starters went 3 IP or less. Known misses: relievers whose
// first start is a real opener on a team that rarely opens, pitchers with
// 0-2 appearances; known false positives: a reliever's first start that turns
// out to be a move into the rotation, a starter ramping up from an injury.

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
  teamOpeners: number   // opener games by the pitcher's team in its last TEAM_GAMES games
}

export interface TeamContext {
  /** Opener games (starter <= 6 outs, next pitcher 9+) in the team's last TEAM_GAMES games. */
  openerGames: number
}

export const OPENER_MAX_OUTS = 6
const RECENT_APPS = 10
const RECENT_STARTS = 5
const STRETCHED_PITCHES = 55
export const TEAM_GAMES = 30
/** A team that opened this many of its last TEAM_GAMES games uses openers. */
export const TEAM_OPENER_MIN = 3

/** `history` = the pitcher's appearances, newest first. */
export function classifyPitcher(history: Appearance[], team?: TeamContext): RoleInfo {
  const recent = history.slice(0, RECENT_APPS)
  const starts = history.filter(a => a.isStart).slice(0, RECENT_STARTS)
  const shortStarts = starts.filter(a => a.outs <= OPENER_MAX_OUTS).length
  const reliefApps = recent.filter(a => !a.isStart).length
  const avgOuts = recent.length ? recent.reduce((s, a) => s + a.outs, 0) / recent.length : null

  // Being stretched out: the latest start already went past 3 innings or 55+
  // pitches (a reliever moving into the rotation, a starter back from the IL).
  const lastStart = starts[0]
  const stretchedOut = lastStart != null && (lastStart.outs >= 10 || (lastStart.pitches ?? 0) >= STRETCHED_PITCHES)

  const patternOfShortStarts = shortStarts >= 3
  // On a team that uses openers, a short reliever handed the ball is an opener
  // even the first time, two appearances are enough to tell, and a swingman
  // who splits starts and relief (half and half) counts too.
  const teamUsesOpeners = (team?.openerGames ?? 0) >= TEAM_OPENER_MIN
  // A reliever's first start is an opener, not a spot start, when they've
  // opened before, are a one-inning arm, or never go long in relief.
  const reliefOuts = recent.filter(a => !a.isStart).slice(0, 5).map(a => a.outs)
  // (3+ relief outings: one short one says nothing about length.)
  const neverLong = reliefOuts.length >= 3 && Math.max(...reliefOuts) <= OPENER_MAX_OUTS
  const shortReliever = recent.length >= (teamUsesOpeners ? 2 : 3)
    && reliefApps / recent.length >= (teamUsesOpeners ? 0.5 : 0.6)
    && avgOuts != null && avgOuts <= OPENER_MAX_OUTS
    && (shortStarts >= 1 || avgOuts <= 4.5 || neverLong || teamUsesOpeners)

  return {
    role: (patternOfShortStarts || shortReliever) && !stretchedOut ? 'opener' : 'starter',
    apps: recent.length,
    reliefApps,
    starts: starts.length,
    shortStarts,
    avgOuts: avgOuts == null ? null : Math.round(avgOuts * 10) / 10,
    teamOpeners: team?.openerGames ?? 0,
  }
}

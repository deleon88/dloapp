/**
 * Client-facing rolling-window hand-split data — public/data/hand_splits_rolling_{season}.json,
 * written by scripts/compute_role_splits.py from play-by-play (MLB Stats API's native
 * sitCodes=[vl,vr] hitting split only works at season granularity — combining it with
 * byDateRange silently returns season-to-date totals, verified empirically; there is no
 * MLB hydrate answer for "vs LHP over the last 30 days", so this is PBP-derived instead).
 *
 * Covers ONLY the four rolling windows (60/30/14/7 days) — 'season'/'season2025' keep
 * using the existing MLB-hydrate path in wrcComputed.ts (already correct, already
 * validated against real FanGraphs numbers) and the FanGraphs-cron path in
 * pitcherHandSplitsCache.ts, untouched by this file.
 *
 * Ships RAW counts only, same convention as pitcherHandSplitsCache.ts — the client
 * applies the existing wRC+/FIP formulas from wrcConstants.ts, with season-wide league
 * context (fetchLeagueContext) and existing park-factor tables, never a window- or
 * split-specific baseline (validated: split-specific league context makes wRC+ ~5x
 * less accurate than season-wide context, see the hand-split MAE diagnosis this
 * session — the same principle is applied here to date windows).
 *
 * No minimum-sample gate is applied here by design (explicit product decision) — a
 * tiny sample (e.g. 3 PA in the last 7 days) still returns a real, honestly-computed
 * number rather than "—". Callers that want a gate apply their own threshold.
 */

import type { RawBattingStat } from '../wrcConstants'

export type RollingPeriod = '60days' | '30days' | '14days' | '7days'

export interface RawSplitCounts {
  ab: number; h1: number; h2: number; h3: number; hr: number
  bb: number; ibb: number; hbp: number; sf: number; pa: number
  rbi?: number
}

export interface RawPitcherSplitCounts extends RawSplitCounts {
  so: number
  outs: number
}

interface RollingWindow {
  asOf: string
  batters: Record<string, { vsL: RawSplitCounts; vsR: RawSplitCounts }>
  pitchers: Record<string, { vsLHB: RawPitcherSplitCounts; vsRHB: RawPitcherSplitCounts }>
}

export interface HandSplitsRollingFile {
  season: number
  generated: string
  windows: Record<RollingPeriod, RollingWindow>
}

/** Converts the pipeline's raw split-count shape into wrcConstants.ts's RawBattingStat. */
export function toRawBattingStat(c: RawSplitCounts): RawBattingStat {
  return {
    atBats:           c.ab,
    hits:             c.h1 + c.h2 + c.h3 + c.hr,
    doubles:          c.h2,
    triples:          c.h3,
    homeRuns:         c.hr,
    baseOnBalls:      c.bb,
    intentionalWalks: c.ibb,
    hitByPitch:       c.hbp,
    sacFlies:         c.sf,
    plateAppearances: c.pa,
  }
}

const _cacheBySeason = new Map<number, HandSplitsRollingFile | null>()
const _inFlightBySeason = new Map<number, Promise<HandSplitsRollingFile | null>>()

export async function loadHandSplitsRollup(season: number): Promise<HandSplitsRollingFile | null> {
  if (_cacheBySeason.has(season)) return _cacheBySeason.get(season)!
  const inFlight = _inFlightBySeason.get(season)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      const res = await fetch(`/data/hand_splits_rolling_${season}.json`)
      if (!res.ok) { _cacheBySeason.set(season, null); return null }
      const data = await res.json() as HandSplitsRollingFile
      _cacheBySeason.set(season, data)
      return data
    } catch {
      _cacheBySeason.set(season, null)
      return null
    } finally {
      _inFlightBySeason.delete(season)
    }
  })()

  _inFlightBySeason.set(season, promise)
  return promise
}

/** Batter's raw counts vs the given opposing-pitcher hand, for a rolling window — null if unseen in that window. */
export function getBatterHandSplitRaw(
  rollup: HandSplitsRollingFile | null,
  batterId: number,
  hand: 'L' | 'R',
  period: RollingPeriod,
): RawBattingStat | null {
  const entry = rollup?.windows[period]?.batters[String(batterId)]
  if (!entry) return null
  return toRawBattingStat(hand === 'L' ? entry.vsL : entry.vsR)
}

/** Batter's RBI vs the given opposing-pitcher hand, for a rolling window — null if unseen or not tracked. */
export function getBatterHandSplitRbi(
  rollup: HandSplitsRollingFile | null,
  batterId: number,
  hand: 'L' | 'R',
  period: RollingPeriod,
): number | null {
  const entry = rollup?.windows[period]?.batters[String(batterId)]
  if (!entry) return null
  return (hand === 'L' ? entry.vsL : entry.vsR).rbi ?? null
}

export interface PitcherHandSplitRaw {
  battingAgainst: RawBattingStat
  so: number
  outs: number
}

/** Pitcher's raw counts vs the given opposing-batter hand, for a rolling window — null if unseen in that window. */
export function getPitcherHandSplitRaw(
  rollup: HandSplitsRollingFile | null,
  pitcherId: number,
  hand: 'L' | 'R',
  period: RollingPeriod,
): PitcherHandSplitRaw | null {
  const entry = rollup?.windows[period]?.pitchers[String(pitcherId)]
  if (!entry) return null
  const counts = hand === 'L' ? entry.vsLHB : entry.vsRHB
  return { battingAgainst: toRawBattingStat(counts), so: counts.so, outs: counts.outs }
}

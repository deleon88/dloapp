/**
 * Server-computed lineup confirmation status + computed stats.
 *
 * Written by scripts/compute_lineup_status.py, chained after the daily stats
 * prefetch in .github/workflows/prefetch-daily-stats.yml (every 30 min,
 * 09:30 UTC through 05:00 UTC next day). Once a game/team side flips to
 * "confirmed", its computedStats are computed exactly once, server-side —
 * the frontend only ever reads this file, never recomputes.
 *
 * Each confirmed batter also carries `vsL`/`vsR` — the vs-LHP/vs-RHP hand
 * splits (wRC+, xwOBA, OPS, wOBA, HR, RBI, PA), computed once server-side the
 * same way. Without this, toggling the batter hand filter forced a live MLB
 * type=[season,statSplits],sitCodes=[vl,vr] hydrate (genuinely slow) for
 * every batter on screen, on every toggle. Only covers the 'season' period —
 * rolling windows already source these from the fast PBP rollup
 * (handSplitsRollup.ts), never this cache.
 *
 * File: public/data/lineup_status_{YYYY-MM-DD}.json
 */

import { todayStr } from '@/utils/period'

export interface CachedLineupSlot {
  playerId: number
  battingOrder: number
  position: string
}

export interface CachedBatterHandSplitStat {
  wrcPlus?: number
  xwoba?: number
  pa?: number
  ops?: number
  woba?: number
  hr?: number
  rbi?: number
}

export interface CachedBatterComputedStat {
  wrcPlus?: number
  xwoba?: number
  pa?: number
  vsL?: CachedBatterHandSplitStat
  vsR?: CachedBatterHandSplitStat
}

export interface CachedTeamLineup {
  goToLineup: CachedLineupSlot[]
  todaysLineup: CachedLineupSlot[] | null
  status: 'projected' | 'confirmed'
  confirmedAt: string | null
  computedStats: Record<string, CachedBatterComputedStat | null> | null
}

export interface LineupStatusFile {
  [gamePk: string]: {
    awayTeam: CachedTeamLineup
    homeTeam: CachedTeamLineup
  }
}

let _cache: LineupStatusFile | null = null
let _cacheDate = ''
let _inFlight: Promise<LineupStatusFile | null> | null = null

export async function loadLineupStatusCache(): Promise<LineupStatusFile | null> {
  const today = todayStr()
  if (_cacheDate === today && _cache !== null) return _cache
  if (_inFlight) return _inFlight

  _inFlight = (async () => {
    try {
      const res = await fetch(`/data/lineup_status_${today}.json`)
      if (!res.ok) return null
      const data = await res.json() as LineupStatusFile
      _cache = data
      _cacheDate = today
      return data
    } catch {
      return null
    } finally {
      _inFlight = null
    }
  })()

  return _inFlight
}

/** Cached team-side lineup entry for a given game, or null if not in the cache yet. */
export function getCachedGameLineup(
  cache: LineupStatusFile | null,
  gamePk: number,
  side: 'away' | 'home',
): CachedTeamLineup | null {
  if (!cache) return null
  const g = cache[String(gamePk)]
  if (!g) return null
  return side === 'away' ? g.awayTeam : g.homeTeam
}

/**
 * Server-computed stats for a confirmed lineup, keyed by playerId.
 * Returns an empty Map when the side isn't confirmed yet or isn't in the
 * cache — callers should fall back to their existing live computation.
 */
export function getCachedComputedStats(
  entry: CachedTeamLineup | null,
): Map<number, CachedBatterComputedStat | null> {
  const map = new Map<number, CachedBatterComputedStat | null>()
  if (!entry || entry.status !== 'confirmed' || !entry.computedStats) return map
  for (const [idStr, stat] of Object.entries(entry.computedStats)) {
    map.set(Number(idStr), stat)
  }
  return map
}

/** Cached vs-LHP/vs-RHP hand-split stat for a batter, or null if the cache doesn't have it. */
export function getCachedBatterHandSplit(
  stat: CachedBatterComputedStat | null | undefined,
  hand: 'L' | 'R',
): CachedBatterHandSplitStat | null {
  if (!stat) return null
  return (hand === 'L' ? stat.vsL : stat.vsR) ?? null
}

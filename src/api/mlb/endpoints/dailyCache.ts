/**
 * Daily pre-computed stats cache.
 *
 * The GitHub Actions workflow (prefetch-daily-stats.yml) runs before first pitch
 * and every 30 min through the afternoon.  It writes:
 *   public/data/daily_stats_{YYYY-MM-DD}.json
 *
 * Shape:
 *   pitchers[playerId][period] = { era, whip, wins, losses, ip, qs,
 *                                   fip, fipMinus, fipPlus, xfip?,
 *                                   xwoba?, strikeOuts, baseOnBalls, ... }
 *   batters[period][playerId]  = { wrcPlus?, xwoba?, pa? }
 *
 * The frontend reads this once per day and skips all live Savant requests.
 * Any player not in the cache (rare — a surprise callup) falls back to live.
 */

import type { StatPeriod } from '@/utils/period'

export interface CachedPitcherPeriod {
  era?: string
  whip?: string
  wins?: number
  losses?: number
  ip?: string
  qs?: number
  strikeOuts?: number
  baseOnBalls?: number
  homeRuns?: number
  hitByPitch?: number
  battersFaced?: number
  fip?: number
  fipMinus?: number
  fipPlus?: number
  xfip?: number
  xwoba?: string   // formatted ".326" or null
}

export interface CachedBatterPeriod {
  wrcPlus?: number
  xwoba?: number   // raw float
  pa?: number
}

interface DailyCache {
  date: string
  generated: string
  season: number
  pitchers: Record<string, Record<string, CachedPitcherPeriod>>  // id → period → stats
  batters: Record<string, Record<string, CachedBatterPeriod>>    // period → id → stats
}

let _cache: DailyCache | null = null
let _cacheDate = ''
let _inFlight: Promise<DailyCache | null> | null = null

function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function loadDailyCache(): Promise<DailyCache | null> {
  const today = todayStr()
  if (_cacheDate === today && _cache !== null) return _cache
  if (_inFlight) return _inFlight

  _inFlight = (async () => {
    try {
      const res = await fetch(`/data/daily_stats_${today}.json`)
      if (!res.ok) return null
      const data = await res.json() as DailyCache
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

/** Period key used in the cache file — maps StatPeriod to the Python script keys. */
function periodKey(period: StatPeriod): string {
  return period   // 'season' | '60days' | '30days' | '14days' | '7days' — match exactly
}

/** Cached pitcher stats for a given player and period. Null if not in cache. */
export function getCachedPitcherStats(
  cache: DailyCache | null,
  playerId: number,
  period: StatPeriod,
): CachedPitcherPeriod | null {
  if (!cache) return null
  return cache.pitchers[String(playerId)]?.[periodKey(period)] ?? null
}

/** Cached batter wRC+ and xwOBA for a given player and period. Null if not in cache. */
export function getCachedBatterStats(
  cache: DailyCache | null,
  playerId: number,
  period: StatPeriod,
): CachedBatterPeriod | null {
  if (!cache) return null
  return cache.batters[periodKey(period)]?.[String(playerId)] ?? null
}

/** Returns a Map<playerId, CachedBatterPeriod> for all batters in a period. */
export function getCachedBatterMap(
  cache: DailyCache | null,
  period: StatPeriod,
): Map<number, CachedBatterPeriod> {
  const map = new Map<number, CachedBatterPeriod>()
  if (!cache) return map
  const periodData = cache.batters[periodKey(period)] ?? {}
  for (const [idStr, entry] of Object.entries(periodData)) {
    map.set(Number(idStr), entry)
  }
  return map
}

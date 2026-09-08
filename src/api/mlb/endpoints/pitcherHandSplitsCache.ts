/**
 * Pitcher vs-LHB / vs-RHB raw rate stats — precomputed by scripts/fetch_fg_pitcher_splits.py
 * (FanGraphs splits API, undocumented — see that script's docstring) and committed daily by
 * .github/workflows/refresh-pitcher-hand-splits.yml. Deliberately NOT fetched live from the
 * browser: every user hitting this endpoint directly would risk FanGraphs rate-limiting or
 * blocking it, so it's cron-only, same treatment as the Guts/park-factor constants.
 *
 * File: public/data/pitcher_hand_splits_{season}.json
 *
 * Only raw rate stats are stored — FanGraphs returns null for ERA-/FIP-/xFIP- on ad-hoc splits
 * (no split-specific league baseline to normalize against, the same root cause validated for
 * batter wRC+ splits: season-wide context beats split-specific by ~5x MAE there). So FIP+/FIP-
 * here are derived the same validated way: computeFipMinus/computeFipPlus from wrcConstants.ts,
 * applied to the split's raw FIP using season-wide lgFIP + park factor.
 */

import { computeFip, computeFipMinus, computeFipPlus, computeWoba } from '../wrcConstants'
import { getFipParkFactor } from './parkFactors'
import { getPitcherHandSplitRaw, type RollingPeriod, type HandSplitsRollingFile } from './handSplitsRollup'
import { isFullSeasonPeriod, type StatPeriod } from '@/utils/period'

export interface PitcherHandSplitRate {
  ip?: number
  era?: number
  fip?: number
  xfip?: number
  whip?: number
  k9?: number
  bb9?: number
  woba?: number
  pa?: number
}

interface PitcherHandSplitsFile {
  season: number
  generated: string
  pitchers: Record<string, { vsLHB?: PitcherHandSplitRate; vsRHB?: PitcherHandSplitRate }>
}

const _cacheBySeason = new Map<number, PitcherHandSplitsFile | null>()
const _inFlightBySeason = new Map<number, Promise<PitcherHandSplitsFile | null>>()

export async function loadPitcherHandSplits(season: number): Promise<PitcherHandSplitsFile | null> {
  if (_cacheBySeason.has(season)) return _cacheBySeason.get(season)!
  const inFlight = _inFlightBySeason.get(season)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      const res = await fetch(`/data/pitcher_hand_splits_${season}.json`)
      if (!res.ok) { _cacheBySeason.set(season, null); return null }
      const data = await res.json() as PitcherHandSplitsFile
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

export interface PitcherHandDisplayStats {
  era?: number
  fip?: number
  xfip?: number
  whip?: number
  k9?: number
  bb9?: number
  woba?: number
  ip?: number
  pa?: number
  fipMinus: number | null
  fipPlus: number | null
  // Raw counts for K-BB% (= (strikeOuts - baseOnBalls) / battersFaced × 100) —
  // PitcherMatchup.tsx's kbbPct() already computes this from these exact field
  // names on PitcherSeasonStats; exposing them here lets LiveGamePage's
  // hand-filter override feed real hand-split numbers into that same function
  // instead of leaving it stuck on season-wide totals.
  strikeOuts?: number
  baseOnBalls?: number
  battersFaced?: number
}

/**
 * Hand-split stats for one pitcher, or null if not in the cache (rare — a
 * pitcher with too few innings in that split to appear on FanGraphs' list).
 * `hand` is the BATTER's hand the pitcher is facing ('L' → vsLHB, 'R' → vsRHB).
 */
export function getPitcherHandSplitStats(
  cache: PitcherHandSplitsFile | null,
  pitcherId: number,
  hand: 'L' | 'R',
  season: number,
  homeTeamId?: number,
): PitcherHandDisplayStats | null {
  if (!cache) return null
  const entry = cache.pitchers[String(pitcherId)]
  const rate = hand === 'L' ? entry?.vsLHB : entry?.vsRHB
  if (!rate) return null

  const parkFactor = homeTeamId != null ? getFipParkFactor(homeTeamId) : 1.00
  const fipMinus = rate.fip != null ? computeFipMinus(rate.fip, season, parkFactor) : null
  const fipPlus = fipMinus != null ? computeFipPlus(fipMinus) : null

  // FanGraphs only gives per-9 rates, not raw counts — derive strikeOuts/baseOnBalls
  // from k9/bb9 × ip/9 for K-BB%. battersFaced is just pa (FanGraphs already reports
  // this as total batters faced against the split, not literal plate appearances).
  const strikeOuts  = rate.ip != null && rate.k9 != null  ? Math.round(rate.k9  * rate.ip / 9) : undefined
  const baseOnBalls = rate.ip != null && rate.bb9 != null ? Math.round(rate.bb9 * rate.ip / 9) : undefined

  return { ...rate, fipMinus, fipPlus, strikeOuts, baseOnBalls, battersFaced: rate.pa }
}

/**
 * Source-selecting wrapper: season/season2025 → the FanGraphs cron cache above
 * (unchanged, already validated); rolling windows (60/30/14/7 days) → the PBP-derived
 * rollup (handSplitsRollup.ts), since FanGraphs' splits are season-only by design.
 *
 * Known gap in the rolling-window path, by design (not silently papered over): ERA
 * and xFIP aren't derivable from the raw counts this pipeline stores (ERA needs
 * earned/unearned run attribution; xFIP needs fly-ball outs — neither is captured by
 * the PBP walk today) — both come back undefined/null rather than falling back to a
 * stale season-wide number. No minimum-sample gate is applied on the rolling-window
 * path (explicit product decision) — a tiny sample still returns a real number.
 */
export function getEffectivePitcherHandSplitStats(
  period: StatPeriod,
  seasonCache: PitcherHandSplitsFile | null,
  rollupCache: HandSplitsRollingFile | null,
  pitcherId: number,
  hand: 'L' | 'R',
  season: number,
  homeTeamId?: number,
): PitcherHandDisplayStats | null {
  if (isFullSeasonPeriod(period)) {
    return getPitcherHandSplitStats(seasonCache, pitcherId, hand, season, homeTeamId)
  }

  const raw = getPitcherHandSplitRaw(rollupCache, pitcherId, hand, period as RollingPeriod)
  if (!raw || raw.outs <= 0) return null

  const ip = raw.outs / 3
  const parkFactor = homeTeamId != null ? getFipParkFactor(homeTeamId) : 1.00
  const fip = computeFip(
    { inningsPitched: ip, homeRuns: raw.battingAgainst.homeRuns, baseOnBalls: raw.battingAgainst.baseOnBalls,
      hitByPitch: raw.battingAgainst.hitByPitch, strikeOuts: raw.so },
    season, 0,  // minIp=0 — no minimum-sample gate on rolling windows, by product decision
  )
  const fipMinus = fip != null ? computeFipMinus(fip, season, parkFactor) : null
  const fipPlus = fipMinus != null ? computeFipPlus(fipMinus) : null

  return {
    ip,
    era: undefined,   // not derivable from PBP raw counts yet — see docstring
    fip: fip ?? undefined,
    xfip: undefined,  // not derivable — no fly-ball-out tracking yet, see docstring
    whip: (raw.battingAgainst.baseOnBalls + raw.battingAgainst.hits) / ip,
    k9: (raw.so / ip) * 9,
    bb9: (raw.battingAgainst.baseOnBalls / ip) * 9,
    woba: computeWoba(raw.battingAgainst, season),
    pa: raw.battingAgainst.plateAppearances,
    fipMinus,
    fipPlus,
    // Exact raw counts from PBP — no derivation needed here, unlike the season/
    // FanGraphs path above.
    strikeOuts: raw.so,
    baseOnBalls: raw.battingAgainst.baseOnBalls,
    battersFaced: raw.battingAgainst.plateAppearances,
  }
}

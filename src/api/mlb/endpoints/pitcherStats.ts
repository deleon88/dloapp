import { mlbApi } from '../client'
import {
  loadLiveConstants, ipToDecimal,
  computeFip, computeFipMinus, computeFipPlus, computeXfip, computeWoba,
  type RawBattingStat,
} from '../wrcConstants'
import { getFipParkFactor } from './parkFactors'
import { fetchSavantPitcherXwoba } from './savantStats'
import { loadDailyCache, getCachedPitcherStats } from './dailyCache'
import { todayStr, periodToSeason, type StatPeriod } from '@/utils/period'

export interface PitcherSeasonStats {
  era: string
  whip: string
  wins: number
  losses: number
  inningsPitched: string
  strikeoutsPer9Inn: string
  walksPer9Inn: string
  strikeoutWalkRatio: string
  runsScoredPer9: string
  strikeOuts: number
  baseOnBalls: number
  homeRuns: number
  hitByPitch: number
  battersFaced: number
  fip: number
  fipMinus: number
  fipComputed:      number | null   // raw FIP computed from counting stats (works for date ranges)
  xfipComputed:     number | null   // xFIP computed from fly balls × lgHR/FB (works for date ranges)
  xwobaComputed:    number | null   // xwOBA from Baseball Savant (works for date ranges)
  fipMinusComputed: number | null   // park-adjusted, computed from raw counts
  fipPlusComputed:  number | null   // park-adjusted, computed from raw counts
  wobaAgainstComputed: number | null // wOBA-against, computed from raw batting-against counts.
                                      // Base value here covers the general (no hand filter) case —
                                      // LiveGamePage.tsx's hand-filter override replaces it with the
                                      // hand-split source's wOBA when a pitcher hand filter is active.
                                      // PitcherMatchup.tsx shows this in place of xwOBA whenever
                                      // xwOBA isn't available (hand-filtered, or Savant/expectedStatistics
                                      // can't supply a trustworthy period-specific number).
  xfip: number
  woba: string
  wobaCon: string
  qualityStarts: number
  inningsPitchedPerGame: string
}

export interface PitcherInfo {
  id: number
  fullName: string
  primaryNumber?: string
  pitchHand?: string
  seasonStats?: PitcherSeasonStats
}

interface StatEntry {
  type: { displayName: string }
  splits: Array<{ stat: Record<string, unknown> }>
}

interface RawPerson {
  id: number
  fullName: string
  primaryNumber?: string
  pitchHand?: { code: string }
  stats?: StatEntry[]
}

export async function fetchPitcherStats(
  personIds: number[],
  homeTeamMap?: Map<number, number>,
  startDate?: string,
  period: StatPeriod = 'season',
): Promise<Map<number, PitcherInfo>> {
  if (!personIds.length) return new Map()

  const season = periodToSeason(period)
  await loadLiveConstants(season)

  const endDate = todayStr()
  const hydrate = startDate
    ? `stats(group=[pitching],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
    : `stats(group=[pitching],type=[season,seasonAdvanced,sabermetrics,expectedStatistics],season=${season})`

  const [data, savantMap, dailyCache] = await Promise.all([
    mlbApi.get<{ people: RawPerson[] }>('/people', {
      personIds: personIds.join(','),
      season,
      hydrate,
      fields: [
        'people', 'id', 'fullName', 'primaryNumber',
        'pitchHand', 'code', 'description',
        'stats', 'type', 'displayName', 'splits', 'stat',
        'era', 'inningsPitched', 'wins', 'losses', 'whip',
        'strikeOuts', 'baseOnBalls', 'homeRuns', 'hitByPitch', 'flyOuts',
        'battersFaced', 'strikeoutsPer9Inn',
        'walksPer9Inn', 'strikeoutWalkRatio', 'runsScoredPer9',
        'fip', 'fipMinus', 'xfip',
        'woba', 'wobaCon',
        'qualityStarts', 'inningsPitchedPerGame',
        // Batting-against raw counts — needed to compute wOBA-against as a
        // general xwOBA fallback (see wobaAgainstComputed below), the same
        // formula already used for the hand-filtered override.
        'atBats', 'hits', 'doubles', 'triples', 'intentionalWalks', 'sacFlies',
      ].join(','),
    }),
    fetchSavantPitcherXwoba(personIds, season, startDate),
    loadDailyCache(),
  ])

  const map = new Map<number, PitcherInfo>()
  for (const p of data.people ?? []) {
    const byType = new Map(
      (p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}])
    )

    type SeasonStat = {
      era?: string; whip?: string; wins?: number; losses?: number
      inningsPitched?: string; strikeoutsPer9Inn?: string; walksPer9Inn?: string
      strikeoutWalkRatio?: string; runsScoredPer9?: string
      strikeOuts?: number; baseOnBalls?: number; homeRuns?: number
      hitByPitch?: number; battersFaced?: number; flyOuts?: number
      atBats?: number; hits?: number; doubles?: number; triples?: number
      intentionalWalks?: number; sacFlies?: number
    }
    type AdvancedStat  = { qualityStarts?: number; inningsPitchedPerGame?: string }
    type SaberStat     = { fip?: number; fipMinus?: number; xfip?: number }
    type ExpStat       = { woba?: string; wobaCon?: string }

    const ss  = (byType.get(startDate ? 'byDateRange' : 'season') ?? {}) as SeasonStat
    const adv = (byType.get('seasonAdvanced')     ?? {}) as AdvancedStat
    const sb  = (byType.get('sabermetrics')       ?? {}) as SaberStat
    const ex  = (byType.get('expectedStatistics') ?? {}) as ExpStat

    // Park-adjusted FIP- / FIP+ computed from raw counting stats
    const homeTeamId = homeTeamMap?.get(p.id)
    const parkFactor = homeTeamId != null ? getFipParkFactor(homeTeamId) : 1.00
    const rawStat = ss.inningsPitched != null ? {
      inningsPitched: ipToDecimal(ss.inningsPitched),
      homeRuns:    ss.homeRuns    ?? 0,
      baseOnBalls: ss.baseOnBalls ?? 0,
      hitByPitch:  ss.hitByPitch  ?? 0,
      strikeOuts:  ss.strikeOuts  ?? 0,
      flyOuts:     ss.flyOuts,
    } : null
    // wOBA-against, computed from the pitcher's own batting-against raw counts
    // (same fields/formula as a batter's wOBA — computeWoba doesn't care whose
    // counts they are). This is the general fallback shown in place of xwOBA
    // whenever xwOBA isn't available — not just under a hand filter — since
    // Savant's pitcher-type query is currently broken for everyone (see
    // xwobaComputed below) and expectedStatistics can't be trusted for rolling
    // windows (silently ignores the date range — verified empirically).
    const battingAgainstRaw: RawBattingStat | null =
      (ss.atBats != null && ss.battersFaced != null) ? {
        atBats:           ss.atBats,
        hits:             ss.hits             ?? 0,
        doubles:          ss.doubles          ?? 0,
        triples:          ss.triples          ?? 0,
        homeRuns:         ss.homeRuns         ?? 0,
        baseOnBalls:      ss.baseOnBalls      ?? 0,
        intentionalWalks: ss.intentionalWalks ?? 0,
        hitByPitch:       ss.hitByPitch       ?? 0,
        sacFlies:         ss.sacFlies         ?? 0,
        plateAppearances: ss.battersFaced,
      } : null
    const wobaAgainstComputed = battingAgainstRaw ? computeWoba(battingAgainstRaw, season) : null

    const rawFip           = rawStat ? computeFip(rawStat, season) : null
    const fipComputed      = rawFip
    // MLB's `season` stat type never returns flyOuts (only `byDateRange` does —
    // verified empirically), so computeXfip always returns null for the season
    // period specifically. Fall back to MLB's own sabermetrics xfip in that
    // case — computeXfip doesn't apply a park adjustment of its own anyway, so
    // nothing is lost by using MLB's value when the counts-based one isn't available.
    const xfipComputed     = (rawStat?.flyOuts != null ? computeXfip(rawStat, season) : null)
      ?? (typeof sb.xfip === 'number' ? sb.xfip : null)
    const fipMinusComputed = rawFip != null ? computeFipMinus(rawFip, season, parkFactor) : null
    const fipPlusComputed  = fipMinusComputed != null ? computeFipPlus(fipMinusComputed) : null

    map.set(p.id, {
      id: p.id,
      fullName: p.fullName,
      primaryNumber: p.primaryNumber,
      pitchHand: p.pitchHand?.code,
      seasonStats: ss.era != null ? {
        era:                  ss.era                  ?? '-.--',
        whip:                 ss.whip                 ?? '-.--',
        wins:                 ss.wins                 ?? 0,
        losses:               ss.losses               ?? 0,
        inningsPitched:       ss.inningsPitched        ?? '0.0',
        strikeoutsPer9Inn:    ss.strikeoutsPer9Inn     ?? '0.0',
        walksPer9Inn:         ss.walksPer9Inn          ?? '0.0',
        strikeoutWalkRatio:   ss.strikeoutWalkRatio    ?? '—',
        runsScoredPer9:       ss.runsScoredPer9        ?? '0.0',
        strikeOuts:           ss.strikeOuts            ?? 0,
        baseOnBalls:          ss.baseOnBalls           ?? 0,
        homeRuns:             ss.homeRuns              ?? 0,
        hitByPitch:           ss.hitByPitch            ?? 0,
        battersFaced:         ss.battersFaced          ?? 0,
        fip:                  sb.fip                   ?? 0,
        fipMinus:             sb.fipMinus              ?? 0,
        fipComputed,
        xfipComputed,
        // xwOBA: daily cache (pre-computed, period-specific) → Savant live → expectedStatistics
        // fallback. The Savant leg is currently broken for every pitcher (verified: Baseball
        // Savant's statcast_search/csv?type=pitcher&player_id=... returns 0 rows regardless of
        // player — a param/format issue on their end, not player-specific), so this fallback is
        // what actually keeps xwOBA populated live; prefetch_daily_stats.py already sources the
        // cached value the same way (expectedStatistics.woba, never Savant, for pitchers).
        xwobaComputed: (() => {
          const cached = getCachedPitcherStats(dailyCache, p.id, period)
          if (cached?.xwoba != null) return parseFloat(cached.xwoba)
          const live = savantMap.get(p.id)
          if (live != null) return live
          return typeof ex.woba === 'string' && ex.woba !== '' ? parseFloat(ex.woba) : null
        })(),
        fipMinusComputed,
        fipPlusComputed,
        wobaAgainstComputed,
        xfip:                 sb.xfip                  ?? 0,
        woba:                 ex.woba                  ?? '-.---',
        wobaCon:              ex.wobaCon               ?? '-.---',
        qualityStarts:        adv.qualityStarts        ?? 0,
        inningsPitchedPerGame: adv.inningsPitchedPerGame ?? '0.0',
      } : undefined,
    })
  }
  return map
}

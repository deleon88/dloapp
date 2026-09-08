import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getGame } from '@/api/mlb/endpoints/schedule'
import { fetchTeamRecentResults } from '@/api/mlb/endpoints/teamRecentResults'
import { fetchPitcherStats } from '@/api/mlb/endpoints/pitcherStats'
import { getGameLineup } from '@/api/mlb/endpoints/boxscore'
import { fetchLineupStats, type PlayerStats } from '@/api/mlb/endpoints/lineupStats'
import { fetchComputedWrcBulk } from '@/api/mlb/endpoints/wrcComputed'
import { fetchSavantBatterXwoba } from '@/api/mlb/endpoints/savantStats'
import { loadDailyCache, getCachedBatterMap } from '@/api/mlb/endpoints/dailyCache'
import { loadLineupStatusCache, getCachedGameLineup, getCachedComputedStats, getCachedBatterHandSplit } from '@/api/mlb/endpoints/lineupStatusCache'
import { loadPitcherHandSplits, getEffectivePitcherHandSplitStats } from '@/api/mlb/endpoints/pitcherHandSplitsCache'
import { loadHandSplitsRollup, type RollingPeriod } from '@/api/mlb/endpoints/handSplitsRollup'
import { fetchDepthChart } from '@/api/mlb/endpoints/teamRoster'
import { fetchTeamPredictions } from '@/api/mlb/endpoints/predictedLineup'
import { getCachedPredictions, setCachedPredictions } from '@/api/mlb/endpoints/lineupPredictionCache'
import { fetchBullpenStats } from '@/api/mlb/endpoints/bullpenStats'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import HandSelect from '@/components/HandSelect/HandSelect'
import { type StatPeriod, getPeriodStartDate, isFullSeasonPeriod, periodToSeason } from '@/utils/period'
import { type HandFilters } from '@/utils/handFilter'
import { loadSavedPeriod, saveSavedPeriod, loadSavedHandFilters, saveSavedHandFilters } from '@/utils/filterPreferences'
import GameMatchupView from './GameMatchupView'
import styles from './LiveGamePage.module.css'

/** Format a numeric rate to baseball convention: ".348" not "0.348" — matches lineupStats.ts's fmtRate. */
function fmtRate3(n: number): string {
  return n.toFixed(3).replace(/^0/, '')
}

export default function LiveGamePage() {
  const { gamePk } = useParams<{ gamePk: string }>()
  const navigate = useNavigate()
  const pk = Number(gamePk)

  // Initialized from localStorage so the filter choice survives navigation
  // to/from SchedulePage (and a page reload) — see filterPreferences.ts.
  const [period, setPeriodState] = useState<StatPeriod>(loadSavedPeriod)
  const [handFilters, setHandFiltersState] = useState<HandFilters>(loadSavedHandFilters)
  const setPeriod = (p: StatPeriod) => { setPeriodState(p); saveSavedPeriod(p) }
  const setHandFilters = (f: HandFilters) => { setHandFiltersState(f); saveSavedHandFilters(f) }
  const startDate = isFullSeasonPeriod(period) ? undefined : getPeriodStartDate(period)
  const season = periodToSeason(period)
  const rollingPeriod = isFullSeasonPeriod(period) ? undefined : (period as RollingPeriod)

  // 1. Base game info (pitchers, venue, weather)
  const gameQuery = useQuery({
    queryKey: ['game', pk],
    queryFn: () => getGame(pk),
    enabled: !!pk,
    staleTime: 60_000,
  })
  const game = gameQuery.data

  // 2. Pitcher season stats
  const awayPitcherId = (game as GameWithPitcher)?.teams?.away?.probablePitcher?.id
  const homePitcherId  = (game as GameWithPitcher)?.teams?.home?.probablePitcher?.id
  const pitcherIds = [awayPitcherId, homePitcherId].filter((id): id is number => id != null)

  // Each pitcher's home team determines the park factor for their season FIP-
  const pitcherHomeTeamMap = (() => {
    const m = new Map<number, number>()
    const aTid = game?.teams.away.team.id
    const hTid = game?.teams.home.team.id
    if (awayPitcherId != null && aTid != null) m.set(awayPitcherId, aTid)
    if (homePitcherId != null && hTid != null) m.set(homePitcherId, hTid)
    return m
  })()

  const pitcherQuery = useQuery({
    queryKey: ['pitcher-stats', period, ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds, pitcherHomeTeamMap, startDate, period),
    enabled: pitcherIds.length > 0,
    // Closed historical seasons (e.g. 2025) are immutable — never refetch once loaded.
    staleTime: period === 'season2025' ? Infinity : 3_600_000,
  })

  // Pitcher vs-LHB/vs-RHB — season path from the FanGraphs cron cache (never fetched
  // live, see pitcherHandSplitsCache.ts); rolling-window path from the PBP rollup (never
  // fetched live either, see handSplitsRollup.ts). Only overrides the displayed stats
  // when the pitcher hand filter is active; probable-pitcher selection is untouched.
  const pitcherHandSplitsQuery = useQuery({
    queryKey: ['pitcher-hand-splits', season],
    queryFn: () => loadPitcherHandSplits(season),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })
  const pitcherHandRollupQuery = useQuery({
    queryKey: ['hand-splits-rollup', season],
    queryFn: () => loadHandSplitsRollup(season),
    enabled: rollingPeriod != null,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  })
  const effectivePitcherStats = useMemo(() => {
    if (handFilters.pitcher === 'all' || !pitcherQuery.data) return pitcherQuery.data
    const map = new Map(pitcherQuery.data)
    for (const [id, info] of map) {
      if (!info.seasonStats) continue
      const hs = getEffectivePitcherHandSplitStats(
        period, pitcherHandSplitsQuery.data ?? null, pitcherHandRollupQuery.data ?? null,
        id, handFilters.pitcher, season, pitcherHomeTeamMap.get(id),
      )
      if (!hs) continue
      // Deliberately never falls back to info.seasonStats.X here — a hand filter with
      // no data for this specific window shows "—"/null, never a stale season number
      // mislabeled as the filtered view (the exact bug this whole feature exists to fix).
      map.set(id, {
        ...info,
        seasonStats: {
          ...info.seasonStats,
          era:              hs.era  != null ? hs.era.toFixed(2)  : '—',
          whip:             hs.whip != null ? hs.whip.toFixed(2) : '—',
          fipComputed:      hs.fip       ?? null,
          xfipComputed:     hs.xfip      ?? null,
          fipMinusComputed: hs.fipMinus,
          fipPlusComputed:  hs.fipPlus,
          wobaAgainstComputed: hs.woba ?? null,
          // K-BB% (PitcherMatchup.tsx's kbbPct()) reads these three fields directly —
          // battersFaced: 0 makes it show "—" rather than silently keep the season-wide
          // K/BB/TBF it would otherwise still be holding from the unfiltered fetch.
          strikeOuts:   hs.strikeOuts   ?? 0,
          baseOnBalls:  hs.baseOnBalls  ?? 0,
          battersFaced: hs.battersFaced ?? 0,
        },
      })
    }
    return map
  }, [pitcherQuery.data, pitcherHandSplitsQuery.data, pitcherHandRollupQuery.data, handFilters.pitcher, period, season, pitcherHomeTeamMap])

  // 3. Batting orders from boxscore (Live / Final games)
  const isPreview = game?.status.abstractGameState === 'Preview'
  const awayTeamId = game?.teams.away.team.id
  const homeTeamId = game?.teams.home.team.id

  const lineupQuery = useQuery({
    queryKey: ['lineup', pk],
    queryFn: () => getGameLineup(pk),
    enabled: !!pk,
    staleTime: 300_000,
  })

  // 4. IL sets + predicted lineups (Preview games only)
  const awayPitcherHand = awayPitcherId ? pitcherQuery.data?.get(awayPitcherId)?.pitchHand : undefined
  const homePitcherHand = homePitcherId ? pitcherQuery.data?.get(homePitcherId)?.pitchHand : undefined

  const awayDepthQuery = useQuery({
    queryKey: ['depth-chart', awayTeamId],
    queryFn: () => fetchDepthChart(awayTeamId!),
    enabled: isPreview && !!awayTeamId,
    staleTime: 3_600_000,
  })
  const homeDepthQuery = useQuery({
    queryKey: ['depth-chart', homeTeamId],
    queryFn: () => fetchDepthChart(homeTeamId!),
    enabled: isPreview && !!homeTeamId,
    staleTime: 3_600_000,
  })

  // Predict both vsRHP and vsLHP in one call per team; serve from localStorage cache when fresh.
  // No pitcher hand required to start — we default to vsRHP when hand is unknown.
  const awayPredictedQuery = useQuery({
    queryKey: ['team-predictions', awayTeamId],
    queryFn: async () => {
      const cached = getCachedPredictions(awayTeamId!)
      if (cached) return cached
      const result = await fetchTeamPredictions(awayTeamId!, awayDepthQuery.data!)
      setCachedPredictions(awayTeamId!, result)
      return result
    },
    enabled: isPreview && !!awayTeamId && !!awayDepthQuery.data,
    staleTime: 3_600_000,
  })
  const homePredictedQuery = useQuery({
    queryKey: ['team-predictions', homeTeamId],
    queryFn: async () => {
      const cached = getCachedPredictions(homeTeamId!)
      if (cached) return cached
      const result = await fetchTeamPredictions(homeTeamId!, homeDepthQuery.data!)
      setCachedPredictions(homeTeamId!, result)
      return result
    },
    enabled: isPreview && !!homeTeamId && !!homeDepthQuery.data,
    staleTime: 3_600_000,
  })

  // Pick the hand-specific prediction; default to vsRHP when pitcher hand is unknown
  const awayPredicted = (homePitcherHand === 'L'
    ? awayPredictedQuery.data?.vsLHP
    : awayPredictedQuery.data?.vsRHP) ?? awayPredictedQuery.data?.vsRHP ?? null

  const homePredicted = (awayPitcherHand === 'L'
    ? homePredictedQuery.data?.vsLHP
    : homePredictedQuery.data?.vsRHP) ?? homePredictedQuery.data?.vsRHP ?? null

  // Effective lineups: confirmed from boxscore, or predicted for Preview games
  const confirmedAway = lineupQuery.data?.away ?? []
  const confirmedHome = lineupQuery.data?.home ?? []
  const awayLineup = confirmedAway.length > 0 ? confirmedAway : (awayPredicted ?? [])
  const homeLineup = confirmedHome.length > 0 ? confirmedHome : (homePredicted ?? [])

  // Current defensive alignment for the fielding diamond — see boxscore.ts's
  // buildCurrentFielders for why this has to be sourced separately from
  // awayLineup/homeLineup above once substitutions occur. No "confirmed"
  // fielders concept pre-game, so Preview games just fall back to the
  // predicted/starting lineup.
  const awayFielders = confirmedAway.length > 0 ? (lineupQuery.data?.awayFielders ?? []) : awayLineup
  const homeFielders = confirmedHome.length > 0 ? (lineupQuery.data?.homeFielders ?? []) : homeLineup

  const awayLineupStatus = awayLineup.length === 0 ? undefined : confirmedAway.length > 0 ? 'confirmed' as const : 'projected' as const
  const homeLineupStatus = homeLineup.length === 0 ? undefined : confirmedHome.length > 0 ? 'confirmed' as const : 'projected' as const

  // 5. Recent results (last 5 W/L per team)
  const gameDate = game?.gameDate ? game.gameDate.split('T')[0] : undefined
  const recentResultsQuery = useQuery({
    queryKey: ['recent-results', gameDate],
    queryFn: () => fetchTeamRecentResults(gameDate!),
    enabled: !!gameDate,
    staleTime: 5 * 60 * 1000,
  })

  // 6. Bullpen stats for both teams (period-aware and now hand-aware)
  const awayBullpenQuery = useQuery({
    queryKey: ['bullpen', period, handFilters.pitcher, awayTeamId],
    queryFn: () => fetchBullpenStats(awayTeamId!, startDate, season, handFilters.pitcher === 'all' ? undefined : handFilters.pitcher, period),
    enabled: !!awayTeamId,
    staleTime: period === 'season2025' ? Infinity : 3_600_000,
  })
  const homeBullpenQuery = useQuery({
    queryKey: ['bullpen', period, handFilters.pitcher, homeTeamId],
    queryFn: () => fetchBullpenStats(homeTeamId!, startDate, season, handFilters.pitcher === 'all' ? undefined : handFilters.pitcher, period),
    enabled: !!homeTeamId,
    staleTime: period === 'season2025' ? Infinity : 3_600_000,
  })

  // 7. wRC+ for each batter (period-aware)
  const allBatterIds = [
    ...awayLineup.map(p => p.id),
    ...homeLineup.map(p => p.id),
  ]

  // Park factor lookup needs each player mapped to their team's home park
  const playerHomeTeamMap = useMemo(() => {
    const m = new Map<number, number>()
    if (awayTeamId) for (const p of awayLineup) m.set(p.id, awayTeamId)
    if (homeTeamId) for (const p of homeLineup) m.set(p.id, homeTeamId)
    return m
  }, [awayLineup, homeLineup, awayTeamId, homeTeamId])

  // "vs Starter Hand" — each side's batters get the OPPOSING starter's throwing
  // hand: away batters face the home starter, home batters face the away
  // starter. Unknown when a probable pitcher/hand isn't announced yet — those
  // batters simply have no entry (resolveBatterHand returns null for them).
  const starterHandByBatter = useMemo(() => {
    const m = new Map<number, 'L' | 'R'>()
    if (homePitcherHand) for (const p of awayLineup) m.set(p.id, homePitcherHand as 'L' | 'R')
    if (awayPitcherHand) for (const p of homeLineup) m.set(p.id, awayPitcherHand as 'L' | 'R')
    return m
  }, [awayLineup, homeLineup, homePitcherHand, awayPitcherHand])

  const batterHandActive = handFilters.batter !== 'all'
  const resolveBatterHand = (id: number): 'L' | 'R' | null => {
    if (handFilters.batter === 'all') return null
    if (handFilters.batter === 'starter') return starterHandByBatter.get(id) ?? null
    return handFilters.batter
  }

  // Daily pre-computed cache — loaded once, covers all periods for all roster players
  const dailyCacheQuery = useQuery({
    queryKey: ['daily-cache'],
    queryFn: loadDailyCache,
    staleTime: 30 * 60_000,   // re-check every 30 min (matches CI cadence)
    gcTime:   60 * 60_000,
  })
  const dailyCache = dailyCacheQuery.data ?? null

  // Server-computed stats for THIS game's confirmed lineup (compute_lineup_status.py,
  // chained after the daily prefetch cron). Once a side flips to "confirmed" its stats
  // are computed exactly once server-side — this is a read-only cache, never a trigger.
  // Only valid for the live 'season' period (the only window the cron precomputes);
  // every other period falls through to the existing live-computation path below.
  const lineupStatusQuery = useQuery({
    queryKey: ['lineup-status'],
    queryFn: loadLineupStatusCache,
    staleTime: 30 * 60_000,
    gcTime:   60 * 60_000,
  })
  const awayStatusEntry = useMemo(
    () => getCachedGameLineup(lineupStatusQuery.data ?? null, pk, 'away'),
    [lineupStatusQuery.data, pk],
  )
  const homeStatusEntry = useMemo(
    () => getCachedGameLineup(lineupStatusQuery.data ?? null, pk, 'home'),
    [lineupStatusQuery.data, pk],
  )
  const lineupStatusBatterMap = useMemo(() => {
    if (period !== 'season') return new Map<number, { wrcPlus?: number; xwoba?: number; pa?: number } | null>()
    return new Map([...getCachedComputedStats(awayStatusEntry), ...getCachedComputedStats(homeStatusEntry)])
  }, [awayStatusEntry, homeStatusEntry, period])

  // Period-aware park-adjusted wRC+ — skip if cache already has it for all batters.
  // Server-confirmed lineup stats (lineupStatusBatterMap) take priority over the
  // broader daily cache when both cover the same player, since the former accounts
  // for game-day surprises (injury/call-up) the latter's roster snapshot may not.
  const cachedBatterMap = useMemo(() => {
    const base = getCachedBatterMap(dailyCache, period)
    if (lineupStatusBatterMap.size === 0) return base
    const merged = new Map(base)
    for (const [id, stat] of lineupStatusBatterMap) {
      if (stat) merged.set(id, stat)
    }
    return merged
  }, [dailyCache, period, lineupStatusBatterMap])
  const allBattersInCache = allBatterIds.length > 0 &&
    allBatterIds.every(id => cachedBatterMap.has(id) && (cachedBatterMap.get(id)?.wrcPlus != null || (cachedBatterMap.get(id)?.pa ?? 0) < 10))

  // Season + hand filter: the lineup-status cache now also carries vsL/vsR
  // (compute_lineup_status.py) — true only when every batter's RESOLVED hand
  // (see resolveBatterHand — "vs Starter Hand" resolves per-batter, and to
  // null with no fallback-to-RHP guess when the opposing starter isn't known
  // yet) is either cached or doesn't need caching at all (null → general
  // stats, covered by allBattersInCache's own check below).
  //
  // `hs.hr !== undefined` guards against a cache entry frozen by an OLDER
  // version of compute_lineup_status.py (before OPS/wOBA/HR/RBI were added to
  // computedStats) — a confirmed side's entry is copied through unchanged
  // forever, so without this check a stale entry with only wrcPlus/xwoba/pa
  // would report "cached" and permanently skip the live fetch, leaving
  // OPS/wOBA/HR/RBI stuck on "—" until the date rolls over. `hr` is always
  // set by the current script whenever the split has any data, so its
  // presence is a reliable freshness marker.
  const allBattersHandCached = batterHandActive && period === 'season' && allBatterIds.length > 0 &&
    allBatterIds.every(id => {
      const hand = resolveBatterHand(id)
      if (hand == null) {
        const c = cachedBatterMap.get(id)
        return !!c && (c.wrcPlus != null || (c.pa ?? 0) < 10)
      }
      const hs = getCachedBatterHandSplit(cachedBatterMap.get(id), hand)
      return hs != null && hs.hr !== undefined && (hs.wrcPlus != null || (hs.pa ?? 0) < 10)
    })

  const wrcPlusQuery = useQuery({
    queryKey: ['lineup-wrc', period, ...allBatterIds],
    queryFn: () => fetchComputedWrcBulk(allBatterIds, playerHomeTeamMap, undefined, season, startDate, rollingPeriod),
    // Caches (dailyCache / lineup-status) only ever cover season totals. For
    // hand-filtered season views, lineup-status may now cover vsL/vsR too
    // (allBattersHandCached) — skip the live fetch when it does; otherwise
    // (rolling windows, or hand splits the cache doesn't have yet) fall
    // through to the live fetch as before. The live fetch itself always
    // returns BOTH vsL and vsR per player (no hand param) — the per-player
    // hand selection happens downstream in wrcMap, which is what makes
    // "vs Starter Hand" (a different hand per batter) work without a
    // per-player live query.
    enabled: allBatterIds.length > 0 && !!awayTeamId && !!homeTeamId &&
      (batterHandActive ? !allBattersHandCached : !allBattersInCache),
    staleTime: season === new Date().getFullYear() ? 3_600_000 : Infinity,
  })

  // Supplemental stats: OPS/HR/RBI/PA (+ wOBA, computed) now period-aware via byDateRange;
  // wRC+/xwOBA still come from wrcPlusQuery/xwobaQuery, which already take priority in the merge below.
  const saberQuery = useQuery({
    queryKey: ['lineup-saber', period, ...allBatterIds],
    queryFn: () => fetchLineupStats(allBatterIds, season, startDate),
    enabled: allBatterIds.length > 0,
    staleTime: 3_600_000,
  })

  // Live Savant xwOBA. Two disjoint groups, since "vs Starter Hand" can mean a
  // different (or no) hand per batter:
  //  - handResolvedTargetIds: batters with an actual L/R to filter by (fixed
  //    L/R filter, or "vs Starter Hand" with a known opposing starter) whose
  //    hand-split cache doesn't cover them yet.
  //  - generalTargetIds: everyone else — filter inactive, OR "vs Starter Hand"
  //    with no announced opposing pitcher yet. These fall back to the exact
  //    same general/unfiltered path used when no batter filter is active at
  //    all (never a guessed RHP split).
  const uncachedBatterIds = allBatterIds.filter(id => !cachedBatterMap.has(id))
  const handResolvedTargetIds = batterHandActive
    ? allBatterIds.filter(id => {
        const hand = resolveBatterHand(id)
        return hand != null && getCachedBatterHandSplit(cachedBatterMap.get(id), hand)?.xwoba == null
      })
    : []
  const generalTargetIds = allBatterIds.filter(id =>
    (!batterHandActive || resolveBatterHand(id) == null) && !cachedBatterMap.has(id),
  )
  const xwobaTargetIds = [...handResolvedTargetIds, ...generalTargetIds]
  const xwobaQuery = useQuery({
    queryKey: ['batter-xwoba', period, handFilters.batter, ...xwobaTargetIds],
    queryFn: async () => {
      const jobs: Promise<Map<number, number>>[] = []
      // General (unfiltered) live fetch — only rolling windows ever need it live;
      // season is always covered by the daily/lineup-status cache instead.
      if (generalTargetIds.length > 0 && !isFullSeasonPeriod(period)) {
        jobs.push(fetchSavantBatterXwoba(generalTargetIds, season, startDate))
      }
      if (handResolvedTargetIds.length > 0) {
        if (handFilters.batter === 'starter') {
          const idsL = handResolvedTargetIds.filter(id => resolveBatterHand(id) === 'L')
          const idsR = handResolvedTargetIds.filter(id => resolveBatterHand(id) === 'R')
          if (idsL.length) jobs.push(fetchSavantBatterXwoba(idsL, season, startDate, 'L'))
          if (idsR.length) jobs.push(fetchSavantBatterXwoba(idsR, season, startDate, 'R'))
        } else if (handFilters.batter === 'L' || handFilters.batter === 'R') {
          jobs.push(fetchSavantBatterXwoba(handResolvedTargetIds, season, startDate, handFilters.batter))
        }
      }
      const maps = await Promise.all(jobs)
      const merged = new Map<number, number>()
      for (const m of maps) for (const [k, v] of m) merged.set(k, v)
      return merged
    },
    enabled: xwobaTargetIds.length > 0 && (!isFullSeasonPeriod(period) || handResolvedTargetIds.length > 0),
    staleTime: 3_600_000,
  })

  // Merge: cache → live wRC+ → live Savant xwOBA → supplemental (full-season fallback)
  const wrcMap = useMemo<Map<number, PlayerStats>>(() => {
    const map = new Map<number, PlayerStats>()
    const allIds = new Set([
      ...allBatterIds,
      ...(saberQuery.data?.keys() ?? []),
      ...(wrcPlusQuery.data?.keys() ?? []),
    ])
    for (const id of allIds) {
      const supp    = saberQuery.data?.get(id) ?? null
      const wrc     = wrcPlusQuery.data?.get(id) ?? null
      const cached  = cachedBatterMap.get(id) ?? null
      // null both when the filter is inactive AND when "vs Starter Hand" has no
      // resolved opposing pitcher yet — both fall back to the general stat below,
      // never a guessed hand.
      const hand    = resolveBatterHand(id)
      const cachedHand = hand != null ? getCachedBatterHandSplit(cached, hand) : null

      // wRC+: hand-filtered → server-computed hand-split cache → live → null.
      const wrcPlus = hand != null
        ? cachedHand?.wrcPlus ?? (hand === 'L' ? wrc?.vsL : wrc?.vsR) ?? null
        : cached?.wrcPlus ?? wrc?.wrcPlus ?? supp?.wRcPlus ?? null

      // xwOBA: hand filter active → hand-split cache → live Savant, never the
      // all-hands cache/supp (which would silently mislabel an unfiltered
      // number as the filtered view). Otherwise: cache (period-specific),
      // then live Savant, then full-season MLB API.
      const liveXwoba = xwobaQuery.data?.get(id) ?? null
      const xwoba = hand != null
        ? (cachedHand?.xwoba != null ? cachedHand.xwoba.toFixed(3).replace(/^0/, '')
          : liveXwoba != null ? liveXwoba.toFixed(3).replace(/^0/, '') : null)
        : (cached?.xwoba != null ? cached.xwoba.toFixed(3).replace(/^0/, '') : null)
          ?? (!isFullSeasonPeriod(period) && liveXwoba != null ? liveXwoba.toFixed(3).replace(/^0/, '') : null)
          ?? supp?.xwoba
          ?? null

      // OPS/wOBA/HR/RBI: hand filter active → hand-split cache → live (same
      // raw split fetched for wRC+, no extra request) → null. Otherwise: the
      // existing period-aware supplemental fetch (saberQuery), unchanged. SB
      // has no hand-split source anywhere in the pipeline (documented gap,
      // out of scope) — always the general/period value regardless of filter.
      const opsNum = hand != null
        ? cachedHand?.ops ?? (hand === 'L' ? wrc?.opsVsL : wrc?.opsVsR) ?? null
        : null
      const wobaNum = hand != null
        ? cachedHand?.woba ?? (hand === 'L' ? wrc?.wobaVsL : wrc?.wobaVsR) ?? null
        : null

      map.set(id, {
        wRcPlus: wrcPlus,
        ops:     hand != null ? (opsNum != null ? fmtRate3(opsNum) : null) : (supp?.ops ?? null),
        woba:    hand != null ? (wobaNum != null ? fmtRate3(wobaNum) : null) : (supp?.woba ?? null),
        xwoba,
        pa:      hand != null
          ? cachedHand?.pa ?? (hand === 'L' ? wrc?.paVsL : wrc?.paVsR) ?? null
          : cached?.pa ?? wrc?.pa ?? supp?.pa ?? null,
        hr:      hand != null
          ? cachedHand?.hr ?? (hand === 'L' ? wrc?.hrVsL : wrc?.hrVsR) ?? null
          : supp?.hr ?? null,
        rbi:     hand != null
          ? cachedHand?.rbi ?? (hand === 'L' ? wrc?.rbiVsL : wrc?.rbiVsR) ?? null
          : supp?.rbi ?? null,
        sb:      supp?.sb ?? null,
      })
    }
    return map
  }, [saberQuery.data, wrcPlusQuery.data, xwobaQuery.data, cachedBatterMap, period, allBatterIds, handFilters.batter, starterHandByBatter])

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <div className={styles.headerRight}>
          <PeriodSelect value={period} onChange={setPeriod} />
          <HandSelect value={handFilters} onChange={setHandFilters} />
        </div>
      </div>

      {gameQuery.isLoading && <p className={styles.loading}>Loading…</p>}
      {gameQuery.error && <p className={styles.loading}>Failed to load game.</p>}

      {game && (
        <GameMatchupView
          game={game}
          pitcherStats={effectivePitcherStats}
          lineup={{ away: awayLineup, home: homeLineup, awayFielders, homeFielders }}
          wrcMap={wrcMap}
          lineupLoading={
            lineupQuery.isLoading ||
            (!allBattersInCache && wrcPlusQuery.isLoading) ||
            (uncachedBatterIds.length > 0 && xwobaQuery.isLoading) ||
            (isPreview && (awayPredictedQuery.isLoading || homePredictedQuery.isLoading))
          }
          awayLineupStatus={awayLineupStatus}
          homeLineupStatus={homeLineupStatus}
          awayBullpen={awayBullpenQuery.data}
          homeBullpen={homeBullpenQuery.data}
          bullpenLoading={awayBullpenQuery.isLoading || homeBullpenQuery.isLoading}
          awayLast5={awayTeamId ? recentResultsQuery.data?.get(awayTeamId) : undefined}
          homeLast5={homeTeamId ? recentResultsQuery.data?.get(homeTeamId) : undefined}
          isPitcherHandFiltered={handFilters.pitcher !== 'all'}
        />
      )}
    </div>
  )
}

interface GameWithPitcher {
  teams: {
    away: { probablePitcher?: { id: number } }
    home: { probablePitcher?: { id: number } }
  }
}

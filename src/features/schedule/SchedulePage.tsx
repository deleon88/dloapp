import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { fetchBullpenFipPlusMap } from '@/api/mlb/endpoints/bullpenStats'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { fetchLineupOffenseMap } from '@/api/mlb/endpoints/lineupOffense'
import { getPeriodStartDate, isFullSeasonPeriod, periodToSeason, type StatPeriod } from '@/utils/period'
import { fetchPitcherStats } from '@/api/mlb/endpoints/pitcherStats'
import { getGoToLineup } from '@/api/mlb/endpoints/goToLineupStore'
import { fetchTeamPredictionsNoDepth } from '@/api/mlb/endpoints/predictedLineup'
import { fetchWrcComputedBulk, weightedWrcAvg, type PlayerWrcPa } from '@/api/mlb/endpoints/lineupOffense'
import { loadLineupStatusCache, getCachedGameLineup, type CachedBatterComputedStat } from '@/api/mlb/endpoints/lineupStatusCache'
import { loadPitcherHandSplits, getEffectivePitcherHandSplitStats } from '@/api/mlb/endpoints/pitcherHandSplitsCache'
import { loadHandSplitsRollup, type RollingPeriod } from '@/api/mlb/endpoints/handSplitsRollup'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import HandSelect from '@/components/HandSelect/HandSelect'
import { type HandFilters } from '@/utils/handFilter'
import { loadSavedPeriod, saveSavedPeriod, loadSavedHandFilters, saveSavedHandFilters } from '@/utils/filterPreferences'
import GameCard from './GameCard'
import DateNav from './DateNav'
import { useT } from '@/i18n/useT'
import styles from './SchedulePage.module.css'

export default function SchedulePage() {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  // Initialized from localStorage so the filter choice survives navigation
  // to/from LiveGamePage (and a page reload) — see filterPreferences.ts.
  const [period, setPeriodState] = useState<StatPeriod>(loadSavedPeriod)
  const [handFilters, setHandFiltersState] = useState<HandFilters>(loadSavedHandFilters)
  const setPeriod = (p: StatPeriod) => { setPeriodState(p); saveSavedPeriod(p) }
  const setHandFilters = (f: HandFilters) => { setHandFiltersState(f); saveSavedHandFilters(f) }
  const startDate = isFullSeasonPeriod(period) ? undefined : getPeriodStartDate(period)
  const season = periodToSeason(period)
  const batterHandActive = handFilters.batter !== 'all'
  const rollingPeriod = isFullSeasonPeriod(period) ? undefined : (period as RollingPeriod)
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  const scheduleQuery = useQuery({
    queryKey: ['schedule', date],
    queryFn: () => getSchedule({ date, hydrate: ['probablePitcher', 'linescore'] }),
    staleTime: 30_000,
  })

  const games = [...(scheduleQuery.data?.dates?.[0]?.games ?? [])].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime(),
  )

  // Auto-advance to tomorrow if today's schedule is fully complete
  const today = format(new Date(), 'yyyy-MM-dd')
  useEffect(() => {
    if (date !== today) return
    if (!scheduleQuery.data || scheduleQuery.isLoading) return
    if (games.length > 0 && games.every(g => g.status.abstractGameState === 'Final')) {
      setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))
    }
  }, [scheduleQuery.data, scheduleQuery.isLoading])

  // Collect all probable pitcher IDs and map each to their home team for park-adjusted FIP
  const { pitcherIds, pitcherHomeTeamMap } = (() => {
    const ids = new Set<number>()
    const teamMap = new Map<number, number>()
    for (const g of games) {
      const gp = g as GameWithPitcher
      const awayId = gp.teams.away.probablePitcher?.id
      const homeId = gp.teams.home.probablePitcher?.id
      if (awayId != null) { ids.add(awayId); teamMap.set(awayId, g.teams.away.team.id) }
      if (homeId != null) { ids.add(homeId); teamMap.set(homeId, g.teams.home.team.id) }
    }
    return { pitcherIds: [...ids], pitcherHomeTeamMap: teamMap }
  })()

  const pitchHandQuery = useQuery({
    queryKey: ['pitch-hands', pitcherIds],
    queryFn: () => getPitchHands(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 86_400_000,
  })

  const pitcherStatsQuery = useQuery({
    queryKey: ['pitcher-stats', period, ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds, pitcherHomeTeamMap, startDate, period),
    enabled: pitcherIds.length > 0,
    staleTime: period === 'season2025' ? Infinity : 3_600_000,
  })

  // Pitcher vs-LHB/vs-RHB — season path from the FanGraphs cron cache, rolling-window
  // path from the PBP rollup (both never fetched live per-request). Only overrides the
  // "Starters" FIP+ bar; probable-pitcher selection is untouched.
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

  const uniqueTeamIds = [...new Set(games.flatMap(g => [g.teams.away.team.id, g.teams.home.team.id]))]

  const bullpenFipQuery = useQuery({
    queryKey: ['bullpen-fip', period, handFilters.pitcher, uniqueTeamIds.slice().sort((a, b) => a - b).join(',')],
    queryFn: () => fetchBullpenFipPlusMap(uniqueTeamIds, startDate, season, handFilters.pitcher === 'all' ? undefined : handFilters.pitcher, period),
    enabled: uniqueTeamIds.length > 0,
    staleTime: period === 'season2025' ? Infinity : 3_600_000,
  })

  // Proactively fetch and cache go-to lineup predictions for every team on the schedule.
  // Teams already stored in the go-to store are skipped. Runs once per date (staleTime: 20h).
  // After resolving, projectedInfo recomputes and picks up the freshly stored lineups.
  const schedPredQuery = useQuery({
    queryKey: ['sched-predictions', date, uniqueTeamIds.slice().sort().join(',')],
    queryFn: async () => {
      const needed = uniqueTeamIds.filter(id => !getGoToLineup(id))
      for (let i = 0; i < needed.length; i += 3) {
        await Promise.all(needed.slice(i, i + 3).map(fetchTeamPredictionsNoDepth))
      }
      return Date.now()
    },
    enabled: uniqueTeamIds.length > 0,
    staleTime: 20 * 60 * 60 * 1000,
    retry: false,
  })

  // "vs Starter Hand" resolves per side, per game: away batters vs the home
  // starter, home batters vs the away starter. Falls back to null (general/
  // unfiltered stats — never a guessed RHP) when that side's opposing
  // pitcher/hand isn't announced yet.
  function resolveHandForSide(side: 'away' | 'home', awayPitcherId?: number, homePitcherId?: number): 'L' | 'R' | null {
    if (handFilters.batter === 'all') return null
    if (handFilters.batter !== 'starter') return handFilters.batter
    const oppId = side === 'away' ? homePitcherId : awayPitcherId
    const hand = oppId != null ? pitchHandQuery.data?.get(oppId) : undefined
    return hand === 'L' || hand === 'R' ? hand : null
  }

  // Confirmed lineup wRC+ from boxscores (PA-weighted)
  const allGamesForLineup = games.map(g => {
    const gp = g as GameWithPitcher
    const awayPitcherId = gp.teams.away.probablePitcher?.id
    const homePitcherId = gp.teams.home.probablePitcher?.id
    return {
      gamePk: g.gamePk,
      awayTeamId: g.teams.away.team.id,
      homeTeamId: g.teams.home.team.id,
      awayHand: resolveHandForSide('away', awayPitcherId, homePitcherId),
      homeHand: resolveHandForSide('home', awayPitcherId, homePitcherId),
    }
  })
  const allGamePks = allGamesForLineup.map(g => g.gamePk).join(',')

  // Server-computed stats for confirmed lineups (compute_lineup_status.py, chained
  // after the daily prefetch cron) — read-only, never triggers a recompute. Only
  // valid for the live 'season' period; other periods fall back to the live
  // per-request computation in lineupOffenseQuery below. Fetched here (before
  // lineupOffenseQuery) since its data seeds cachedHandWrcMap, which
  // lineupOffenseQuery uses to skip live wRC+ fetches for already-cached batters.
  const lineupStatusQuery = useQuery({
    queryKey: ['lineup-status'],
    queryFn: loadLineupStatusCache,
    staleTime: 30 * 60_000,
    gcTime:   60 * 60_000,
  })

  // Server-computed vs-LHP/vs-RHP wRC+ for every confirmed batter, across all
  // of today's games — built from lineupStatusQuery once it resolves. Passed
  // into fetchLineupOffenseMap so it can skip the live (slow) hand-split hydrate
  // for every batter this already covers; only uncovered batters (unconfirmed
  // lineups, or a hand-split the cache doesn't have) still hit MLB live. Each
  // side uses its own resolved hand (awayHand/homeHand — relevant for "vs
  // Starter Hand", where the two sides of the same game can differ).
  const cachedHandWrcMap = useMemo(() => {
    const map = new Map<number, PlayerWrcPa>()
    if (!batterHandActive || period !== 'season' || !lineupStatusQuery.data) return map
    for (const { gamePk, awayHand, homeHand } of allGamesForLineup) {
      const sides: Array<['away' | 'home', 'L' | 'R' | null]> = [['away', awayHand], ['home', homeHand]]
      for (const [side, hand] of sides) {
        if (hand == null) continue   // unresolved starter hand — falls back to the general stat, no cache lookup needed
        const entry = getCachedGameLineup(lineupStatusQuery.data, gamePk, side)
        if (entry?.status !== 'confirmed' || !entry.computedStats) continue
        for (const [idStr, stat] of Object.entries(entry.computedStats)) {
          const hs = hand === 'L' ? stat?.vsL : stat?.vsR
          if (hs?.wrcPlus != null) map.set(Number(idStr), { wrc: hs.wrcPlus, pa: hs.pa ?? 1 })
        }
      }
    }
    return map
  }, [lineupStatusQuery.data, batterHandActive, period, allGamePks, handFilters.batter, pitchHandQuery.data])

  const lineupOffenseQuery = useQuery({
    queryKey: ['lineup-offense', period, handFilters.batter, date, allGamePks, cachedHandWrcMap.size],
    queryFn: () => fetchLineupOffenseMap(allGamesForLineup, season, startDate, rollingPeriod, cachedHandWrcMap),
    // Wait for the cheap lineup-status JSON to resolve before firing a season +
    // hand-filter fetch, so cachedHandWrcMap is populated on the first request
    // instead of only from the second query onward.
    enabled: allGamesForLineup.length > 0 &&
      (period !== 'season' || !batterHandActive || !lineupStatusQuery.isLoading),
    staleTime: 120_000,
  })

  // Projected lineup: read player IDs from go-to store for unconfirmed teams,
  // pick vsRHP vs vsLHP based on opposing pitcher hand. schedPredQuery.data is
  // a dependency so this recomputes once proactive predictions are stored.
  const projectedInfo = useMemo(() => {
    void schedPredQuery.data
    const lineupOffense = lineupOffenseQuery.data
    const pitchHands    = pitchHandQuery.data

    const teamPlayerIds     = new Map<number, number[]>()
    const playerHomeTeamMap = new Map<number, number>()

    for (const game of games) {
      const gp         = game as GameWithPitcher
      const gl         = lineupOffense?.get(game.gamePk)
      const homeTeamId = game.teams.home.team.id

      if (!gl || gl.awayCount === 0) {
        const homePitcherId = gp.teams.home.probablePitcher?.id
        const hand = homePitcherId ? pitchHands?.get(homePitcherId) as 'R' | 'L' | undefined : undefined
        const stored = getGoToLineup(game.teams.away.team.id)
        const lineup = hand === 'L' ? stored?.vsLHP : stored?.vsRHP
        if (lineup?.length) {
          const ids = lineup.map(p => p.id)
          teamPlayerIds.set(game.teams.away.team.id, ids)
          for (const id of ids) playerHomeTeamMap.set(id, homeTeamId)
        }
      }

      if (!gl || gl.homeCount === 0) {
        const awayPitcherId = gp.teams.away.probablePitcher?.id
        const hand = awayPitcherId ? pitchHands?.get(awayPitcherId) as 'R' | 'L' | undefined : undefined
        const stored = getGoToLineup(homeTeamId)
        const lineup = hand === 'L' ? stored?.vsLHP : stored?.vsRHP
        if (lineup?.length) {
          const ids = lineup.map(p => p.id)
          teamPlayerIds.set(homeTeamId, ids)
          for (const id of ids) playerHomeTeamMap.set(id, homeTeamId)
        }
      }
    }

    const allIds = [...new Set([...teamPlayerIds.values()].flat())]
    return { teamPlayerIds, playerHomeTeamMap, allIds }
  }, [games, lineupOffenseQuery.data, pitchHandQuery.data, schedPredQuery.data])

  const projectedWrcQuery = useQuery({
    queryKey: ['projected-sched-wrc', period, projectedInfo.allIds.slice().sort().join(',')],
    queryFn: () => fetchWrcComputedBulk(projectedInfo.allIds, projectedInfo.playerHomeTeamMap, undefined, season, startDate, rollingPeriod),
    enabled: projectedInfo.allIds.length > 0,
    staleTime: (period === 'season2025' ? Infinity : 3_600_000),
  })
  const projectedWrc = (ids: number[], hand: 'L' | 'R' | null) =>
    projectedWrcQuery.data ? weightedWrcAvg(ids, projectedWrcQuery.data, hand ?? undefined) ?? undefined : undefined

  const lineupOffense   = lineupOffenseQuery.data
  const bullpenFipPlus  = bullpenFipQuery.data
  const pitchHands      = pitchHandQuery.data
  const pitcherStatsMap = pitcherStatsQuery.data


  const t = useT()

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>{t('mlbGames')}</h1>
        </div>
        <div className={styles.headerRight}>
          <PeriodSelect value={period} onChange={setPeriod} />
          <HandSelect value={handFilters} onChange={setHandFilters} />
          <button className={styles.glossaryBtn} onClick={() => setGlossaryOpen(true)} aria-label="Stat guide">?</button>
        </div>
      </div>

      {glossaryOpen && <StatBarsModal onClose={() => setGlossaryOpen(false)} />}

      <DateNav
        date={date}
        onPrev={() => setDate(format(subDays(parseISO(date), 1), 'yyyy-MM-dd'))}
        onNext={() => setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))}
      />

      {scheduleQuery.isLoading && <SkeletonList />}

      {scheduleQuery.error && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>{t('couldNotLoadGames')}</p>
          <p className={styles.stateDetail}>{t('checkConnection')}</p>
        </div>
      )}

      {!scheduleQuery.isLoading && !scheduleQuery.error && games.length === 0 && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>{t('noGamesScheduled')}</p>
          <p className={styles.stateDetail}>{t('tryDifferentDate')}</p>
        </div>
      )}

      <div className={styles.list}>
        {games.map((game, i) => {
          const gp = game as GameWithPitcher
          const awayPitcherId = gp.teams.away.probablePitcher?.id
          const homePitcherId = gp.teams.home.probablePitcher?.id
          const awayHandSplit = handFilters.pitcher !== 'all' && awayPitcherId
            ? getEffectivePitcherHandSplitStats(period, pitcherHandSplitsQuery.data ?? null, pitcherHandRollupQuery.data ?? null, awayPitcherId, handFilters.pitcher, season, pitcherHomeTeamMap.get(awayPitcherId))
            : null
          const homeHandSplit = handFilters.pitcher !== 'all' && homePitcherId
            ? getEffectivePitcherHandSplitStats(period, pitcherHandSplitsQuery.data ?? null, pitcherHandRollupQuery.data ?? null, homePitcherId, handFilters.pitcher, season, pitcherHomeTeamMap.get(homePitcherId))
            : null
          const awayFipPlus = awayHandSplit?.fipPlus
            ?? (awayPitcherId ? pitcherStatsMap?.get(awayPitcherId)?.seasonStats?.fipPlusComputed ?? undefined : undefined)
          const homeFipPlus = homeHandSplit?.fipPlus
            ?? (homePitcherId ? pitcherStatsMap?.get(homePitcherId)?.seasonStats?.fipPlusComputed ?? undefined : undefined)

          // Batter hand filter, resolved per side — "vs Starter Hand" gives away
          // batters the home starter's hand and home batters the away starter's
          // hand; null (general/unfiltered stats) if that side's filter is off
          // or the opposing starter/hand isn't known yet.
          const awayBatterHand = resolveHandForSide('away', awayPitcherId, homePitcherId)
          const homeBatterHand = resolveHandForSide('home', awayPitcherId, homePitcherId)

          const gameLineup    = lineupOffense?.get(game.gamePk)
          const awayConfirmed = (gameLineup?.awayCount ?? 0) > 0
          const homeConfirmed = (gameLineup?.homeCount ?? 0) > 0
          const awayLineupStatus = awayConfirmed ? 'confirmed' as const : getGoToLineup(game.teams.away.team.id) ? 'projected' as const : undefined
          const homeLineupStatus = homeConfirmed ? 'confirmed' as const : getGoToLineup(game.teams.home.team.id) ? 'projected' as const : undefined

          // Server-computed (cron) stats take priority over the live per-request
          // fetch below when available — same "compute once, read many" contract
          // as LiveGamePage. Only applies to the live 'season' period; the cron
          // now also computes vsL/vsR hand splits (compute_lineup_status.py), so
          // a batter hand filter uses this cache too, not just the unfiltered view.
          const awayStatusEntry = period === 'season'
            ? getCachedGameLineup(lineupStatusQuery.data ?? null, game.gamePk, 'away')
            : null
          const homeStatusEntry = period === 'season'
            ? getCachedGameLineup(lineupStatusQuery.data ?? null, game.gamePk, 'home')
            : null
          const cachedAwayWrc = awayStatusEntry?.status === 'confirmed'
            ? weightedWrcFromCachedStats(awayStatusEntry.computedStats, awayBatterHand ?? undefined)
            : undefined
          const cachedHomeWrc = homeStatusEntry?.status === 'confirmed'
            ? weightedWrcFromCachedStats(homeStatusEntry.computedStats, homeBatterHand ?? undefined)
            : undefined

          // Offense: confirmed → server-cached PA-weighted wRC+, else live boxscore fetch
          //          projected → PA-weighted wRC+ from API sabermetrics for projected players
          //          neither   → omit (bar shows —)
          const awayWrc: number | undefined = awayConfirmed
            ? (cachedAwayWrc ?? gameLineup!.awayWrc ?? undefined)
            : projectedWrc(projectedInfo.teamPlayerIds.get(game.teams.away.team.id) ?? [], awayBatterHand)

          const homeWrc: number | undefined = homeConfirmed
            ? (cachedHomeWrc ?? gameLineup!.homeWrc ?? undefined)
            : projectedWrc(projectedInfo.teamPlayerIds.get(game.teams.home.team.id) ?? [], homeBatterHand)

          return (
            <GameCard
              key={game.gamePk}
              game={game}
              awayWrc={awayWrc}
              homeWrc={homeWrc}
              awayFipPlus={awayFipPlus}
              homeFipPlus={homeFipPlus}
              awayBullpenFipPlus={bullpenFipPlus?.get(game.teams.away.team.id)}
              homeBullpenFipPlus={bullpenFipPlus?.get(game.teams.home.team.id)}
              awayPitchHand={awayPitcherId ? pitchHands?.get(awayPitcherId) : undefined}
              homePitchHand={homePitcherId ? pitchHands?.get(homePitcherId) : undefined}
              awayLineupStatus={awayLineupStatus}
              homeLineupStatus={homeLineupStatus}
              animDelay={i * 60}
            />
          )
        })}
      </div>

      <footer className={styles.footer}>
        {t('mlbData')}
      </footer>
    </div>
  )
}

interface GameWithPitcher {
  teams: {
    away: { probablePitcher?: { id: number; fullName: string } }
    home: { probablePitcher?: { id: number; fullName: string } }
  }
}

/**
 * PA-weighted average wRC+ from a compute_lineup_status.py computedStats map.
 * @param hand - optional 'L'|'R' to average the vsL/vsR split instead of the season value.
 */
function weightedWrcFromCachedStats(
  stats: Record<string, CachedBatterComputedStat | null> | null,
  hand?: 'L' | 'R',
): number | undefined {
  if (!stats) return undefined
  let sumWrcPa = 0, sumPa = 0
  for (const s of Object.values(stats)) {
    if (!s) continue
    const hs  = hand === 'L' ? s.vsL : hand === 'R' ? s.vsR : undefined
    const wrc = hand ? hs?.wrcPlus : s.wrcPlus
    const pa  = hand ? hs?.pa : s.pa
    if (wrc == null) continue
    sumWrcPa += wrc * (pa ?? 0)
    sumPa += pa ?? 0
  }
  return sumPa === 0 ? undefined : Math.round(sumWrcPa / sumPa)
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 180, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  )
}

const FIP_RATINGS = [
  { label: 'Excellent',     value: '≥ 130', tier: 'excellent' },
  { label: 'Great',         value: '≥ 120', tier: 'great'     },
  { label: 'Above Average', value: '≥ 110', tier: 'above'     },
  { label: 'Average',       value: '100',   tier: 'avg'       },
  { label: 'Below Average', value: '≤ 90',  tier: 'below'     },
  { label: 'Poor',          value: '≤ 85',  tier: 'poor'      },
  { label: 'Awful',         value: '≤ 75',  tier: 'awful'     },
]

const WRC_RATINGS = [
  { label: 'Excellent',     value: '≥ 160', tier: 'excellent' },
  { label: 'Great',         value: '≥ 140', tier: 'great'     },
  { label: 'Above Average', value: '≥ 115', tier: 'above'     },
  { label: 'Average',       value: '100',   tier: 'avg'       },
  { label: 'Below Average', value: '≤ 80',  tier: 'below'     },
  { label: 'Poor',          value: '≤ 75',  tier: 'poor'      },
  { label: 'Awful',         value: '≤ 60',  tier: 'awful'     },
]

const TIER: Record<string, string> = {
  excellent: styles.tierExcellent,
  great:     styles.tierGreat,
  above:     styles.tierAbove,
  avg:       styles.tierAvg,
  below:     styles.tierBelow,
  poor:      styles.tierPoor,
  awful:     styles.tierAwful,
}

function StatBarsModal({ onClose }: { onClose: () => void }) {
  const t = useT()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{t('statBarsGuide')}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <StatPanel label={t('fipPlusLabel')} desc={t('fipPlusDesc')} ratings={FIP_RATINGS} />
          <StatPanel label={t('wrcPlusLabel')} desc={t('wrcPlusDesc')} ratings={WRC_RATINGS} />
        </div>
      </div>
    </div>
  )
}

function StatPanel({ label, desc, ratings }: {
  label: string
  desc: string
  ratings: { label: string; value: string; tier: string }[]
}) {
  return (
    <div className={styles.statPanel}>
      <div className={styles.statPanelLabel}>{label}</div>
      <p className={styles.statPanelDesc}>{desc}</p>
      <div className={styles.ratingTable}>
        {ratings.map(r => (
          <div key={r.label} className={`${styles.ratingRow} ${TIER[r.tier]}`}>
            <span className={styles.ratingLabel}>{r.label}</span>
            <span className={styles.ratingValue}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

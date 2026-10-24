import { mlbToday } from '@/utils/etDate'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { fetchBullpenFipPlusMap } from '@/api/mlb/endpoints/bullpenStats'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { fetchLineupOffenseMap } from '@/api/mlb/endpoints/lineupOffense'
import { applyPitcherHand, fetchPitcherStats, fipPlus } from '@/api/mlb/endpoints/pitcherStats'
import { fetchGoToLineups, goToFor } from '@/api/lineups'
import { fetchPitcherRoles, fetchProjectedStarters, missingProbable, projectedBulks, starterValue, withProjectedStarters } from '@/api/pitcherRoles'
import { fetchWrcComputedBulk, weightedWrcAvg } from '@/api/mlb/endpoints/lineupOffense'
import { batterSplitFor } from '@/utils/handFilter'
import { useStatFilters } from '@/utils/useStatFilters'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import HandSelect from '@/components/HandSelect/HandSelect'
import GameCard from './GameCard'
import DateNav from './DateNav'
import { useT } from '@/i18n/useT'
import StatBarsGuide from './StatBarsGuide'
import styles from './SchedulePage.module.css'

export default function SchedulePage() {
  const [date, setDate] = useState(() => mlbToday())
  // Saved across pages; signed-in users only (see useStatFilters).
  const { period, setPeriod, handFilters, setHandFilters, locked: filtersLocked } = useStatFilters()
  const [glossaryOpen, setGlossaryOpen] = useState(false)

  const scheduleQuery = useQuery({
    queryKey: ['schedule', date],
    queryFn: () => getSchedule({ date, hydrate: ['probablePitcher', 'linescore'] }),
    staleTime: 30_000,
  })

  const rawGames = useMemo(() => [...(scheduleQuery.data?.dates?.[0]?.games ?? [])].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime(),
  ), [scheduleQuery.data])

  // Starters not announced yet: projected from the rotation (flagged on the card)
  const projectedQuery = useQuery({
    queryKey: ['projected-starters', date],
    queryFn: () => fetchProjectedStarters(date),
    enabled: rawGames.some(missingProbable),
    staleTime: 30 * 60_000,
  })
  const games = useMemo(() => rawGames.map(g => withProjectedStarters(g, projectedQuery.data)), [rawGames, projectedQuery.data])

  // On first load, jump to tomorrow if today's slate is already complete — only
  // once, so going back to today with the arrow stays there.
  const today = mlbToday()
  const allFinal = !!scheduleQuery.data && games.length > 0 && games.every(g => g.status.abstractGameState === 'Final')
  const advanced = useRef(false)
  useEffect(() => {
    if (advanced.current || date !== today || !scheduleQuery.data) return
    advanced.current = true
    if (allFinal) setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))
  }, [date, today, allFinal, scheduleQuery.data])

  // Collect all probable pitcher IDs from the schedule
  const pitcherIds = [
    ...new Set(
      games.flatMap((g) => {
        const gp = g as GameWithPitcher
        return [
          gp.teams.away.probablePitcher?.id,
          gp.teams.home.probablePitcher?.id,
        ].filter((id): id is number => id != null)
      }),
    ),
  ]

  const pitchHandQuery = useQuery({
    queryKey: ['pitch-hands', pitcherIds],
    queryFn: () => getPitchHands(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 86_400_000,
  })

  const pitcherStatsQuery = useQuery({
    queryKey: ['pitcher-stats', period, ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds, period),
    enabled: pitcherIds.length > 0,
    staleTime: 3_600_000,
    placeholderData: prev => prev,
  })

  // Opener or real starter: an opener's bar is blended with the team bullpen.
  const probables = games.flatMap(g => {
    const gp = g as GameWithPitcher
    return (['away', 'home'] as const).flatMap(side => {
      const id = gp.teams[side].probablePitcher?.id
      return id ? [{ id, teamId: g.teams[side].team.id }] : []
    })
  })
  const rolesQuery = useQuery({
    queryKey: ['pitcher-roles', date, ...probables.map(p => `${p.id}-${p.teamId}`).sort()],
    queryFn: () => fetchPitcherRoles(probables, date),
    enabled: probables.length > 0,
    staleTime: 3_600_000,
  })
  // A projected opener (the projection knows it opens ahead of a bulk arm) counts too
  const projBulks = useMemo(() => projectedBulks(games), [games])
  const isOpener = (id?: number) => id != null && (rolesQuery.data?.get(id)?.role === 'opener' || projBulks.has(id))
  const bulkOf = (id?: number) => (id != null ? rolesQuery.data?.get(id)?.bulk ?? projBulks.get(id) ?? undefined : undefined)
  // Probable bulk arms behind openers: their FIP+ replaces the bullpen's in the blend.
  const bulkIds = [...new Set([
    ...[...(rolesQuery.data?.values() ?? [])].flatMap(r => (r.bulk ? [r.bulk.id] : [])),
    ...[...projBulks.values()].map(b => b.id),
  ])]
  const bulkStatsQuery = useQuery({
    queryKey: ['pitcher-stats', period, ...bulkIds],
    queryFn: () => fetchPitcherStats(bulkIds, period),
    enabled: bulkIds.length > 0,
    staleTime: 3_600_000,
  })

  const uniqueTeamIds = [...new Set(games.flatMap(g => [g.teams.away.team.id, g.teams.home.team.id]))]

  const bullpenFipQuery = useQuery({
    queryKey: ['bullpen-fip', uniqueTeamIds.slice().sort((a, b) => a - b).join(','), period, handFilters.pitcher],
    queryFn: () => fetchBullpenFipPlusMap(uniqueTeamIds, period, handFilters.pitcher),
    enabled: uniqueTeamIds.length > 0,
    staleTime: 3_600_000,
    placeholderData: prev => prev,
  })

  // Go-to lineups (vs RHP / vs LHP) of every team on the schedule, built on the server.
  const goToQuery = useQuery({
    queryKey: ['go-to-lineups', ...uniqueTeamIds.slice().sort((a, b) => a - b)],
    queryFn: () => fetchGoToLineups(uniqueTeamIds),
    enabled: uniqueTeamIds.length > 0,
    staleTime: 15 * 60_000,
  })
  const goTo = goToQuery.data

  // Confirmed lineup wRC+ from boxscores (PA-weighted)
  const allGamesForLineup = games.map(g => ({
    gamePk: g.gamePk,
    awayTeamId: g.teams.away.team.id,
    homeTeamId: g.teams.home.team.id,
  }))
  const allGamePks = allGamesForLineup.map(g => g.gamePk).join(',')

  const lineupOffenseQuery = useQuery({
    queryKey: ['lineup-offense', date, allGamePks, period],
    queryFn: () => fetchLineupOffenseMap(allGamesForLineup, period),
    enabled: allGamesForLineup.length > 0,
    staleTime: 120_000,
    placeholderData: prev => prev,   // al cambiar de periodo, mantener los números anteriores mientras carga
  })

  // Projected lineup: the go-to player IDs for teams without a confirmed lineup,
  // vs RHP or vs LHP depending on the opposing starter's hand.
  const projectedInfo = useMemo(() => {
    const lineupOffense = lineupOffenseQuery.data
    const pitchHands    = pitchHandQuery.data

    const teamPlayerIds = new Map<number, number[]>()

    for (const game of games) {
      // Only games still to be played get a projection: a postponed game (which
      // MLB marks Final) or a finished one without a boxscore order gets none.
      if (game.status.abstractGameState !== 'Preview') continue
      const gp         = game as GameWithPitcher
      const gl         = lineupOffense?.games.get(game.gamePk)
      const homeTeamId = game.teams.home.team.id

      if (!gl || gl.awayIds.length === 0) {
        const homePitcherId = gp.teams.home.probablePitcher?.id
        const hand = homePitcherId ? pitchHands?.get(homePitcherId) : undefined
        const lineup = goToFor(goTo?.get(game.teams.away.team.id), hand)
        if (lineup?.length) teamPlayerIds.set(game.teams.away.team.id, lineup.map(p => p.id))
      }

      if (!gl || gl.homeIds.length === 0) {
        const awayPitcherId = gp.teams.away.probablePitcher?.id
        const hand = awayPitcherId ? pitchHands?.get(awayPitcherId) : undefined
        const lineup = goToFor(goTo?.get(homeTeamId), hand)
        if (lineup?.length) teamPlayerIds.set(homeTeamId, lineup.map(p => p.id))
      }
    }

    const allIds = [...new Set([...teamPlayerIds.values()].flat())]
    return { teamPlayerIds, allIds }
  }, [games, lineupOffenseQuery.data, pitchHandQuery.data, goTo])

  const projectedWrcQuery = useQuery({
    queryKey: ['projected-sched-wrc', projectedInfo.allIds.slice().sort().join(','), period],
    queryFn: () => fetchWrcComputedBulk(projectedInfo.allIds, period),
    enabled: projectedInfo.allIds.length > 0,
    staleTime: 3_600_000,
    placeholderData: prev => prev,
  })

  const lineupOffense   = lineupOffenseQuery.data
  const bullpenFipPlus  = bullpenFipQuery.data
  const pitchHands      = pitchHandQuery.data
  // Pitcher hand filter: starters' numbers vs left- or right-handed batters only.
  const pitcherStatsMap = useMemo(() => {
    const stats = pitcherStatsQuery.data
    return stats && handFilters.pitcher !== 'all' ? applyPitcherHand(stats, handFilters.pitcher) : stats
  }, [pitcherStatsQuery.data, handFilters.pitcher])
  const projectedWrcMap = projectedWrcQuery.data
  const bulkStatsMap = useMemo(() => {
    const stats = bulkStatsQuery.data
    return stats && handFilters.pitcher !== 'all' ? applyPitcherHand(stats, handFilters.pitcher) : stats
  }, [bulkStatsQuery.data, handFilters.pitcher])
  const bulkFipPlus = (openerId?: number) => {
    const b = bulkOf(openerId)
    const fm = b ? bulkStatsMap?.get(b.id)?.seasonStats?.fipMinus : undefined
    return fm ? fipPlus(fm) : undefined
  }


  const t = useT()

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>{t('mlbGames')}</h1>
        </div>
        <div className={styles.headerRight}>
          <PeriodSelect value={period} onChange={setPeriod} locked={filtersLocked} />
          <HandSelect value={handFilters} onChange={setHandFilters} locked={filtersLocked} />
          <button className={styles.glossaryBtn} onClick={() => setGlossaryOpen(true)} aria-label="Stat guide">?</button>
        </div>
      </div>

      {glossaryOpen && <StatBarsGuide onClose={() => setGlossaryOpen(false)} />}

      <DateNav
        date={date}
        today={today}
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
          const awayFipMinus = awayPitcherId ? pitcherStatsMap?.get(awayPitcherId)?.seasonStats?.fipMinus : undefined
          const homeFipMinus = homePitcherId ? pitcherStatsMap?.get(homePitcherId)?.seasonStats?.fipMinus : undefined

          const gameLineup    = lineupOffense?.games.get(game.gamePk)
          const awayConfirmed = (gameLineup?.awayIds.length ?? 0) > 0
          const homeConfirmed = (gameLineup?.homeIds.length ?? 0) > 0
          const upcoming = game.status.abstractGameState === 'Preview'
          const awayLineupStatus = awayConfirmed ? 'confirmed' as const : upcoming && projectedInfo.teamPlayerIds.has(game.teams.away.team.id) ? 'projected' as const : undefined
          const homeLineupStatus = homeConfirmed ? 'confirmed' as const : upcoming && projectedInfo.teamPlayerIds.has(game.teams.home.team.id) ? 'projected' as const : undefined

          // Hand filter: each lineup faces the OTHER team's starter.
          const awaySplit = batterSplitFor(handFilters.batter, homePitcherId ? pitchHands?.get(homePitcherId) : undefined)
          const homeSplit = batterSplitFor(handFilters.batter, awayPitcherId ? pitchHands?.get(awayPitcherId) : undefined)

          // Offense: confirmed → PA-weighted wRC+ of the boxscore batting order
          //          projected → PA-weighted wRC+ of the go-to lineup
          //          neither (or starter hand unknown with "vs Starter Hand") → omit (bar shows —)
          const sideWrc = (confirmedIds: number[] | undefined, teamId: number, split: typeof awaySplit) => {
            if (!split) return undefined
            if (confirmedIds?.length) return weightedWrcAvg(confirmedIds, lineupOffense!.wrc, split) ?? undefined
            if (!upcoming || !projectedWrcMap) return undefined
            return weightedWrcAvg(projectedInfo.teamPlayerIds.get(teamId) ?? [], projectedWrcMap, split) ?? undefined
          }
          const awayWrc = sideWrc(gameLineup?.awayIds, game.teams.away.team.id, awaySplit)
          const homeWrc = sideWrc(gameLineup?.homeIds, game.teams.home.team.id, homeSplit)

          return (
            <GameCard
              key={game.gamePk}
              game={game}
              awayWrc={awayWrc}
              homeWrc={homeWrc}
              awayFipPlus={starterValue(awayFipMinus ? fipPlus(awayFipMinus) : undefined, isOpener(awayPitcherId), bullpenFipPlus?.get(game.teams.away.team.id), bulkFipPlus(awayPitcherId))}
              homeFipPlus={starterValue(homeFipMinus ? fipPlus(homeFipMinus) : undefined, isOpener(homePitcherId), bullpenFipPlus?.get(game.teams.home.team.id), bulkFipPlus(homePitcherId))}
              awayOpener={isOpener(awayPitcherId)}
              homeOpener={isOpener(homePitcherId)}
              awayBulk={bulkOf(awayPitcherId)}
              homeBulk={bulkOf(homePitcherId)}
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

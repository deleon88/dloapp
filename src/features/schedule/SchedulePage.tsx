import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { fetchBullpenFipPlusMap } from '@/api/mlb/endpoints/bullpenStats'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { fetchLineupOffenseMap } from '@/api/mlb/endpoints/lineupOffense'
import { fetchPitcherStats, fipPlus } from '@/api/mlb/endpoints/pitcherStats'
import { getGoToLineup } from '@/api/mlb/endpoints/goToLineupStore'
import { fetchTeamPredictionsNoDepth } from '@/api/mlb/endpoints/predictedLineup'
import { fetchWrcByHandBulk, weightedWrcByHand } from '@/api/mlb/endpoints/wrcByHand'
import { type StatPeriod } from '@/utils/period'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import GameCard from './GameCard'
import DateNav from './DateNav'
import { useT } from '@/i18n/useT'
import styles from './SchedulePage.module.css'

export default function SchedulePage() {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [_period, _setPeriod] = useState<StatPeriod>('season')

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
    queryKey: ['pitcher-stats', ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 3_600_000,
  })

  const uniqueTeamIds = [...new Set(games.flatMap(g => [g.teams.away.team.id, g.teams.home.team.id]))]
  const bullpenFipQuery = useQuery({
    queryKey: ['bullpen-fip', uniqueTeamIds.slice().sort((a, b) => a - b).join(',')],
    queryFn: () => fetchBullpenFipPlusMap(uniqueTeamIds),
    enabled: uniqueTeamIds.length > 0,
    staleTime: 3_600_000,
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

  // Confirmed lineup wRC+ from boxscores (PA-weighted)
  const allGamesForLineup = games.map(g => ({
    gamePk: g.gamePk,
    awayTeamId: g.teams.away.team.id,
    homeTeamId: g.teams.home.team.id,
  }))
  const allGamePks = allGamesForLineup.map(g => g.gamePk).join(',')

  const lineupOffenseQuery = useQuery({
    queryKey: ['lineup-offense', date, allGamePks],
    queryFn: () => fetchLineupOffenseMap(allGamesForLineup),
    enabled: allGamesForLineup.length > 0,
    staleTime: 120_000,
  })

  // Projected lineup: read player IDs from go-to store for unconfirmed teams,
  // pick vsRHP vs vsLHP based on opposing pitcher hand. schedPredQuery.data is
  // a dependency so this recomputes once proactive predictions are stored.
  const projectedInfo = useMemo(() => {
    void schedPredQuery.data
    const lineupOffense = lineupOffenseQuery.data
    const pitchHands    = pitchHandQuery.data

    const teamPlayerIds = new Map<number, number[]>()
    const teamHands     = new Map<number, 'R' | 'L' | undefined>()

    for (const game of games) {
      const gp = game as GameWithPitcher
      const gl = lineupOffense?.get(game.gamePk)

      if (!gl || gl.awayCount === 0) {
        const homePitcherId = gp.teams.home.probablePitcher?.id
        const hand = homePitcherId ? pitchHands?.get(homePitcherId) as 'R' | 'L' | undefined : undefined
        const stored = getGoToLineup(game.teams.away.team.id)
        const lineup = hand === 'L' ? stored?.vsLHP : stored?.vsRHP
        if (lineup?.length) {
          teamPlayerIds.set(game.teams.away.team.id, lineup.map(p => p.id))
          teamHands.set(game.teams.away.team.id, hand)
        }
      }

      if (!gl || gl.homeCount === 0) {
        const awayPitcherId = gp.teams.away.probablePitcher?.id
        const hand = awayPitcherId ? pitchHands?.get(awayPitcherId) as 'R' | 'L' | undefined : undefined
        const stored = getGoToLineup(game.teams.home.team.id)
        const lineup = hand === 'L' ? stored?.vsLHP : stored?.vsRHP
        if (lineup?.length) {
          teamPlayerIds.set(game.teams.home.team.id, lineup.map(p => p.id))
          teamHands.set(game.teams.home.team.id, hand)
        }
      }
    }

    const allIds = [...new Set([...teamPlayerIds.values()].flat())]
    return { teamPlayerIds, teamHands, allIds }
  }, [games, lineupOffenseQuery.data, pitchHandQuery.data, schedPredQuery.data])

  const projectedWrcQuery = useQuery({
    queryKey: ['projected-sched-wrc-hand', projectedInfo.allIds.slice().sort().join(',')],
    queryFn: () => fetchWrcByHandBulk(projectedInfo.allIds),
    enabled: projectedInfo.allIds.length > 0,
    staleTime: 3_600_000,
  })

  const lineupOffense      = lineupOffenseQuery.data
  const bullpenFipPlus     = bullpenFipQuery.data
  const pitchHands         = pitchHandQuery.data
  const pitcherStatsMap    = pitcherStatsQuery.data
  const projectedWrcByHand = projectedWrcQuery.data

  const t = useT()

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>{t('mlbGames')}</h1>
        </div>
        <PeriodSelect value={_period} onChange={_setPeriod} />
      </div>

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
          const awayFipMinus = awayPitcherId ? pitcherStatsMap?.get(awayPitcherId)?.seasonStats?.fipMinus : undefined
          const homeFipMinus = homePitcherId ? pitcherStatsMap?.get(homePitcherId)?.seasonStats?.fipMinus : undefined

          const gameLineup    = lineupOffense?.get(game.gamePk)
          const awayConfirmed = (gameLineup?.awayCount ?? 0) > 0
          const homeConfirmed = (gameLineup?.homeCount ?? 0) > 0
          const awayLineupStatus = awayConfirmed ? 'confirmed' as const : awayPitcherId ? 'projected' as const : undefined
          const homeLineupStatus = homeConfirmed ? 'confirmed' as const : homePitcherId ? 'projected' as const : undefined

          // Offense: confirmed → PA-weighted wRC+ from boxscore
          //          projected → PA-weighted per-hand wRC+ (vs RHP or vs LHP)
          //          neither   → omit (bar shows —)
          const awayWrc: number | undefined = awayConfirmed
            ? (gameLineup!.awayWrc ?? undefined)
            : projectedWrcByHand
              ? (weightedWrcByHand(
                  projectedInfo.teamPlayerIds.get(game.teams.away.team.id) ?? [],
                  projectedWrcByHand,
                  projectedInfo.teamHands.get(game.teams.away.team.id),
                ) ?? undefined)
              : undefined

          const homeWrc: number | undefined = homeConfirmed
            ? (gameLineup!.homeWrc ?? undefined)
            : projectedWrcByHand
              ? (weightedWrcByHand(
                  projectedInfo.teamPlayerIds.get(game.teams.home.team.id) ?? [],
                  projectedWrcByHand,
                  projectedInfo.teamHands.get(game.teams.home.team.id),
                ) ?? undefined)
              : undefined

          return (
            <GameCard
              key={game.gamePk}
              game={game}
              awayWrc={awayWrc}
              homeWrc={homeWrc}
              awayFipPlus={awayFipMinus ? fipPlus(awayFipMinus) : undefined}
              homeFipPlus={homeFipMinus ? fipPlus(homeFipMinus) : undefined}
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

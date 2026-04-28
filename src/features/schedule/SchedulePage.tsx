import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { fetchTeamOpsPlus } from '@/api/mlb/endpoints/teamStats'
import { fetchBullpenFipPlusMap } from '@/api/mlb/endpoints/bullpenStats'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { fetchLineupOffenseMap } from '@/api/mlb/endpoints/lineupOffense'
import { fetchPitcherStats, fipPlus } from '@/api/mlb/endpoints/pitcherStats'
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
    staleTime: 86_400_000, // 24h — handedness never changes
  })

  const pitcherStatsQuery = useQuery({
    queryKey: ['pitcher-stats', ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 3_600_000,
  })

  const opsPlusQuery = useQuery({
    queryKey: ['ops-plus'],
    queryFn: () => fetchTeamOpsPlus(),
    staleTime: 3_600_000,
  })

  const uniqueTeamIds = [...new Set(games.flatMap(g => [g.teams.away.team.id, g.teams.home.team.id]))]
  const bullpenFipQuery = useQuery({
    queryKey: ['bullpen-fip', uniqueTeamIds.slice().sort((a, b) => a - b).join(',')],
    queryFn: () => fetchBullpenFipPlusMap(uniqueTeamIds),
    enabled: uniqueTeamIds.length > 0,
    staleTime: 3_600_000,
  })

  // Fetch lineups for all games — lineups can be posted before game starts
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

  const opsPlus = opsPlusQuery.data
  const bullpenFipPlus = bullpenFipQuery.data
  const pitchHands = pitchHandQuery.data
  const lineupOffense = lineupOffenseQuery.data
  const pitcherStatsMap = pitcherStatsQuery.data

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
          const awayId = gp.teams.away.probablePitcher?.id
          const homeId = gp.teams.home.probablePitcher?.id
          const awayFipMinus = awayId ? pitcherStatsMap?.get(awayId)?.seasonStats?.fipMinus : undefined
          const homeFipMinus = homeId ? pitcherStatsMap?.get(homeId)?.seasonStats?.fipMinus : undefined
          const gameLineup = lineupOffense?.get(game.gamePk)
          const awayConfirmed = (gameLineup?.awayCount ?? 0) > 0
          const homeConfirmed = (gameLineup?.homeCount ?? 0) > 0
          const awayLineupStatus = awayConfirmed ? 'confirmed' as const : awayId ? 'projected' as const : undefined
          const homeLineupStatus = homeConfirmed ? 'confirmed' as const : homeId ? 'projected' as const : undefined
          return (
            <GameCard
              key={game.gamePk}
              game={game}
              awayOpsPlus={awayConfirmed ? (gameLineup!.awayWrc ?? undefined) : opsPlus?.get(game.teams.away.team.id)?.opsPlus}
              homeOpsPlus={homeConfirmed ? (gameLineup!.homeWrc ?? undefined) : opsPlus?.get(game.teams.home.team.id)?.opsPlus}
              awayFipPlus={awayFipMinus ? fipPlus(awayFipMinus) : undefined}
              homeFipPlus={homeFipMinus ? fipPlus(homeFipMinus) : undefined}
              awayBullpenFipPlus={bullpenFipPlus?.get(game.teams.away.team.id)}
              homeBullpenFipPlus={bullpenFipPlus?.get(game.teams.home.team.id)}
              awayPitchHand={awayId ? pitchHands?.get(awayId) : undefined}
              homePitchHand={homeId ? pitchHands?.get(homeId) : undefined}
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

// Hydrated type for probablePitcher with id
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

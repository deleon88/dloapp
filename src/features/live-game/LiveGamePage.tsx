import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getGame } from '@/api/mlb/endpoints/schedule'
import { fetchPitcherStats } from '@/api/mlb/endpoints/pitcherStats'
import { getGameLineup } from '@/api/mlb/endpoints/boxscore'
import { fetchLineupStats } from '@/api/mlb/endpoints/lineupStats'
import { fetchDepthChart } from '@/api/mlb/endpoints/teamRoster'
import { fetchTeamPredictions } from '@/api/mlb/endpoints/predictedLineup'
import { getCachedPredictions, setCachedPredictions } from '@/api/mlb/endpoints/lineupPredictionCache'
import { fetchBullpenStats } from '@/api/mlb/endpoints/bullpenStats'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import type { StatPeriod } from '@/utils/period'
import GameMatchupView from './GameMatchupView'
import styles from './LiveGamePage.module.css'

export default function LiveGamePage() {
  const { gamePk } = useParams<{ gamePk: string }>()
  const navigate = useNavigate()
  const pk = Number(gamePk)

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

  const pitcherQuery = useQuery({
    queryKey: ['pitcher-stats', ...pitcherIds],
    queryFn: () => fetchPitcherStats(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 3_600_000,
  })

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

  const awayLineupStatus = awayLineup.length === 0 ? undefined : confirmedAway.length > 0 ? 'confirmed' as const : 'projected' as const
  const homeLineupStatus = homeLineup.length === 0 ? undefined : confirmedHome.length > 0 ? 'confirmed' as const : 'projected' as const

  // 5. Bullpen stats for both teams
  const awayBullpenQuery = useQuery({
    queryKey: ['bullpen', awayTeamId],
    queryFn: () => fetchBullpenStats(awayTeamId!),
    enabled: !!awayTeamId,
    staleTime: 3_600_000,
  })
  const homeBullpenQuery = useQuery({
    queryKey: ['bullpen', homeTeamId],
    queryFn: () => fetchBullpenStats(homeTeamId!),
    enabled: !!homeTeamId,
    staleTime: 3_600_000,
  })

  // 6. wRC+ for each batter
  const allBatterIds = [
    ...awayLineup.map(p => p.id),
    ...homeLineup.map(p => p.id),
  ]
  const saberQuery = useQuery({
    queryKey: ['lineup-saber', ...allBatterIds],
    queryFn: () => fetchLineupStats(allBatterIds),
    enabled: allBatterIds.length > 0,
    staleTime: 3_600_000,
  })

  const [period, setPeriod] = useState<StatPeriod>('season')

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>

      {gameQuery.isLoading && <p className={styles.loading}>Loading…</p>}
      {gameQuery.error && <p className={styles.loading}>Failed to load game.</p>}

      {game && (
        <GameMatchupView
          game={game}
          pitcherStats={pitcherQuery.data}
          lineup={{ away: awayLineup, home: homeLineup }}
          wrcMap={saberQuery.data}
          lineupLoading={
            lineupQuery.isLoading || saberQuery.isLoading ||
            (isPreview && (awayPredictedQuery.isLoading || homePredictedQuery.isLoading))
          }
          awayLineupStatus={awayLineupStatus}
          homeLineupStatus={homeLineupStatus}
          awayBullpen={awayBullpenQuery.data}
          homeBullpen={homeBullpenQuery.data}
          bullpenLoading={awayBullpenQuery.isLoading || homeBullpenQuery.isLoading}
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

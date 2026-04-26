import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { ScheduledGame } from '@/api/mlb/types'
import type { PitcherInfo } from '@/api/mlb/endpoints/pitcherStats'
import type { GameLineup } from '@/api/mlb/endpoints/boxscore'
import type { PlayerStats } from '@/api/mlb/endpoints/lineupStats'
import type { BullpenStats } from '@/api/mlb/endpoints/bullpenStats'
import { getTeamMeta, getBarColor, capLogoUrl } from '@/data/teams'
import type { ViewMode, LineupStatus } from './LineupComparison'
import CardBgLayers from './CardBgLayers'
import PitcherMatchup from './PitcherMatchup'
import WeatherCard from './WeatherCard'
import LineupComparison from './LineupComparison'
import BullpenCard from './BullpenCard'
import styles from './GameMatchupView.module.css'

interface HydratedGame extends ScheduledGame {
  teams: ScheduledGame['teams'] & {
    away: ScheduledGame['teams']['away'] & {
      probablePitcher?: { id: number; fullName: string }
      team: ScheduledGame['teams']['away']['team'] & {
        locationName?: string
        teamName?: string
      }
    }
    home: ScheduledGame['teams']['home'] & {
      probablePitcher?: { id: number; fullName: string }
      team: ScheduledGame['teams']['home']['team'] & {
        locationName?: string
        teamName?: string
      }
    }
  }
  weather?: { condition: string; temp: string; wind: string }
}

interface Props {
  game: ScheduledGame
  pitcherStats?: Map<number, PitcherInfo>
  lineup?: GameLineup
  wrcMap?: Map<number, PlayerStats>
  lineupLoading?: boolean
  awayLineupStatus?: LineupStatus
  homeLineupStatus?: LineupStatus
  awayBullpen?: BullpenStats
  homeBullpen?: BullpenStats
  bullpenLoading?: boolean
}

export default function GameMatchupView({
  game,
  pitcherStats,
  lineup,
  wrcMap,
  lineupLoading,
  awayLineupStatus,
  homeLineupStatus,
  awayBullpen,
  homeBullpen,
  bullpenLoading,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('comparison')


  const g = game as HydratedGame
  const { teams, gameDate, venue } = g

  const away = getTeamMeta(teams.away.team.id)
  const home  = getTeamMeta(teams.home.team.id)

  const ac = away?.color ?? '#555'
  const hc = home?.color ?? '#555'
  const acBar = away ? getBarColor(away) : ac
  const hcBar = home ? getBarColor(home) : hc

  const time = format(parseISO(gameDate), 'h:mm a')

  const awayPitcher = teams.away.probablePitcher
    ? pitcherStats?.get(teams.away.probablePitcher.id)
    : undefined
  const homePitcher = teams.home.probablePitcher
    ? pitcherStats?.get(teams.home.probablePitcher.id)
    : undefined

  const awayCity = away?.name ?? teams.away.team.locationName ?? teams.away.team.name
  const homeCity = home?.name ?? teams.home.team.locationName ?? teams.home.team.name
  const awayNick = away?.brief ?? teams.away.team.teamName ?? teams.away.team.name
  const homeNick = home?.brief ?? teams.home.team.teamName ?? teams.home.team.name

  const awayW = teams.away.leagueRecord.wins
  const awayL = teams.away.leagueRecord.losses
  const homeW = teams.home.leagueRecord.wins
  const homeL = teams.home.leagueRecord.losses

  return (
    <div className={styles.root}>

      {/* ── Game header ──────────────────────────────────────── */}
      <div className={styles.header}>
        <CardBgLayers awayColor={ac} homeColor={hc} mode={mode} />
        <div className={styles.teamBlock}>
          <img src={capLogoUrl(teams.away.team.id)} alt={awayNick} width={44} height={44} />
          <div>
            <div className={styles.teamCity}>{awayCity}</div>
            <div className={styles.teamNickname}>
              <span className={styles.nickFull}>{awayNick.toUpperCase()}</span>
              <span className={styles.nickAbbr}>{away?.abbr ?? awayNick.slice(0, 3).toUpperCase()}</span>
            </div>
            <div className={styles.teamRecord}>{awayW}-{awayL}</div>
          </div>
        </div>

        <div className={styles.gameInfo}>
          <div className={styles.venueName}>{venue.name}</div>
          <div className={styles.gameTime}>{time}</div>
        </div>

        <div className={`${styles.teamBlock} ${styles.teamBlockRight}`}>
          <div style={{ textAlign: 'right' }}>
            <div className={styles.teamCity}>{homeCity}</div>
            <div className={styles.teamNickname}>
              <span className={styles.nickFull}>{homeNick.toUpperCase()}</span>
              <span className={styles.nickAbbr}>{home?.abbr ?? homeNick.slice(0, 3).toUpperCase()}</span>
            </div>
            <div className={styles.teamRecord}>{homeW}-{homeL}</div>
          </div>
          <img src={capLogoUrl(teams.home.team.id)} alt={homeNick} width={44} height={44} />
        </div>
      </div>

      {/* ── Pitcher matchup ────────────────────────────────── */}
      <PitcherMatchup
        awayPitcher={awayPitcher}
        homePitcher={homePitcher}
        awayColor={ac}
        homeColor={hc}
        awayBarColor={acBar}
        homeBarColor={hcBar}
        awayPitcherName={teams.away.probablePitcher?.fullName}
        homePitcherName={teams.home.probablePitcher?.fullName}
        mode={mode}
      />

      {/* ── Lineup comparison ──────────────────────────────── */}
      <LineupComparison
        awayTeamId={teams.away.team.id}
        homeTeamId={teams.home.team.id}
        awayLineup={lineup?.away ?? []}
        homeLineup={lineup?.home ?? []}
        wrcMap={wrcMap ?? new Map()}
        isLoading={lineupLoading}
        mode={mode}
        onModeChange={setMode}
        awayLineupStatus={awayLineupStatus}
        homeLineupStatus={homeLineupStatus}
      />

      {/* ── Weather ────────────────────────────────────────── */}
      {g.weather?.condition && <WeatherCard weather={g.weather} awayColor={ac} homeColor={hc} mode={mode} />}

      {/* ── Bullpen ────────────────────────────────────────── */}
      <BullpenCard
        away={awayBullpen}
        home={homeBullpen}
        awayColor={ac}
        homeColor={hc}
        mode={mode}
        isLoading={bullpenLoading}
      />

    </div>
  )
}

import { mlbApi } from '../client'
import { etDate } from '@/utils/etDate'

export interface UsageDay {
  gamePk: number // a doubleheader has two entries with the same date
  date: string   // "2026-04-28", MLB official (ET) date
  label: string  // "4/28"
}

export interface BullpenUsage {
  days: UsageDay[]
  pitchMap: Map<number, number[]>  // playerId → pitch count per day (same indices as days[])
}

interface ScheduleGame {
  gamePk: number
  officialDate: string
  status: { abstractGameState: string }
}

interface BoxscoreTeamSide {
  team: { id: number }
  pitchers: number[]
  players: Record<string, {
    stats: { pitching: { numberOfPitches?: number } }
  }>
}

function fmtLabel(date: string): string {
  const [, m, d] = date.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

export async function fetchBullpenUsage(teamId: number): Promise<BullpenUsage> {
  const today = etDate()
  const start = etDate(14)

  const schedRes = await mlbApi.get<{
    dates: Array<{ games: ScheduleGame[] }>
  }>('/schedule', {
    sportId: 1,
    teamId,
    startDate: start,
    endDate: today,
    fields: 'dates,games,gamePk,officialDate,status,abstractGameState',
  })

  const completed = (schedRes.dates ?? [])
    .flatMap(d => d.games)
    .filter(g => g.status.abstractGameState === 'Final')
    .slice(-5)

  if (!completed.length) return { days: [], pitchMap: new Map() }

  const days: UsageDay[] = completed.map(g => ({
    gamePk: g.gamePk,
    date: g.officialDate,
    label: fmtLabel(g.officialDate),
  }))

  const boxscores = await Promise.all(
    completed.map(g =>
      mlbApi.get<{ teams: { away: BoxscoreTeamSide; home: BoxscoreTeamSide } }>(
        `/game/${g.gamePk}/boxscore`,
        { fields: 'teams,away,home,team,id,pitchers,players,person,stats,pitching,numberOfPitches' },
      )
    )
  )

  const pitchMap = new Map<number, number[]>()

  for (let i = 0; i < boxscores.length; i++) {
    const bs = boxscores[i]
    const side = bs.teams.away.team.id === teamId ? bs.teams.away : bs.teams.home
    for (const pitcherId of side.pitchers) {
      if (!pitchMap.has(pitcherId)) {
        pitchMap.set(pitcherId, Array(completed.length).fill(0))
      }
      const pitches = side.players[`ID${pitcherId}`]?.stats?.pitching?.numberOfPitches ?? 0
      pitchMap.get(pitcherId)![i] = pitches
    }
  }

  return { days, pitchMap }
}

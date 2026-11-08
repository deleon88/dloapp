import { mlbApi } from '../client'
import type { ScheduleResponse } from '../types'
import { shiftDate } from '@/utils/etDate'
import { leagueParams, type LeagueKey } from '@/data/leagues'

export type GameResult = 'W' | 'L'

const FIELDS = [
  'dates', 'games', 'gamePk',
  'status', 'abstractGameState',
  'teams', 'away', 'home', 'team', 'id', 'score',
].join(',')

/** Last 5 results per team before `beforeDate` (the game's official ET date, YYYY-MM-DD). */
export async function fetchTeamRecentResults(
  beforeDate: string,
  league: LeagueKey = 'MLB',
): Promise<Map<number, GameResult[]>> {
  const res = await mlbApi.get<ScheduleResponse>('/schedule', {
    ...leagueParams(league),
    startDate: shiftDate(beforeDate, -18),
    endDate: shiftDate(beforeDate, -1),
    fields: FIELDS,
  })

  const resultMap = new Map<number, GameResult[]>()

  for (const date of res.dates ?? []) {
    for (const game of date.games) {
      if (game.status?.abstractGameState !== 'Final') continue
      const awayScore = game.teams.away.score ?? 0
      const homeScore = game.teams.home.score ?? 0
      if (awayScore === homeScore) continue

      const awayId = game.teams.away.team.id
      const homeId = game.teams.home.team.id
      const awayWon = awayScore > homeScore

      if (!resultMap.has(awayId)) resultMap.set(awayId, [])
      if (!resultMap.has(homeId)) resultMap.set(homeId, [])

      resultMap.get(awayId)!.push(awayWon ? 'W' : 'L')
      resultMap.get(homeId)!.push(!awayWon ? 'W' : 'L')
    }
  }

  for (const [id, results] of resultMap) {
    resultMap.set(id, results.slice(-5))
  }

  return resultMap
}

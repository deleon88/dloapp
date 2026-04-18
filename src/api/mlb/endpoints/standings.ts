import { mlbApi } from '../client'
import type { StandingsResponse } from '../types'

export type StandingsType =
  | 'regularSeason'
  | 'wildCard'
  | 'divisionLeaders'
  | 'firstHalf'
  | 'secondHalf'
  | 'springTraining'
  | 'postseason'

export interface GetStandingsParams {
  leagueId?: number | number[]
  season?: number
  standingsTypes?: StandingsType
  date?: string
}

const STANDINGS_FIELDS = [
  'records', 'standingsType',
  'teamRecords', 'team', 'id', 'name',
  'wins', 'losses', 'winningPercentage',
  'gamesBack', 'magicNumber', 'eliminationNumber',
  'streak', 'streakCode',
  'divisionRank', 'leagueRank',
  'divisionGamesBack', 'leagueGamesBack',
  'division', 'id', 'name',
  'league', 'id', 'name',
].join(',')

export function getStandings(params: GetStandingsParams = {}): Promise<StandingsResponse> {
  const {
    leagueId = [103, 104],
    season = new Date().getFullYear(),
    standingsTypes = 'regularSeason',
    ...rest
  } = params

  return mlbApi.get<StandingsResponse>('/standings', {
    leagueId: Array.isArray(leagueId) ? leagueId.join(',') : leagueId,
    standingsTypes,
    season,
    hydrate: 'division,league',
    fields: STANDINGS_FIELDS,
    ...rest,
  })
}

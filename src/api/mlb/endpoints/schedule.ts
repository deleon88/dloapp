import { mlbApi } from '../client'
import type { ScheduleResponse } from '../types'

export interface GetScheduleParams {
  date?: string
  startDate?: string
  endDate?: string
  sportId?: number
  teamId?: number
  gameType?: string
  hydrate?: string[]
}

const SCHEDULE_FIELDS = [
  'dates', 'date', 'games', 'gamePk', 'gameDate', 'dayNight',
  'status', 'abstractGameState', 'detailedState',
  'teams', 'away', 'home', 'team', 'id', 'name',
  'leagueRecord', 'wins', 'losses', 'score',
  'probablePitcher', 'fullName', 'id',
  'linescore', 'currentInning', 'inningState',
  'innings', 'num', 'runs',
  'venue',
].join(',')

export function getSchedule(params: GetScheduleParams = {}): Promise<ScheduleResponse> {
  const { hydrate, ...rest } = params
  return mlbApi.get<ScheduleResponse>('/schedule', {
    sportId: 1,
    gameType: 'R',
    ...rest,
    ...(hydrate ? { hydrate: hydrate.join(',') } : {}),
    fields: SCHEDULE_FIELDS,
  })
}

const GAME_FIELDS = [
  'dates', 'games', 'gamePk', 'gameDate', 'dayNight',
  'status', 'abstractGameState', 'detailedState',
  'teams', 'away', 'home', 'team', 'id', 'name',
  'leagueRecord', 'wins', 'losses', 'score',
  'probablePitcher', 'fullName', 'id',
  'linescore', 'currentInning', 'inningState',
  'outs', 'balls', 'strikes', 'innings', 'num', 'runs', 'hits', 'errors',
  'weather', 'condition', 'temp', 'wind',
  'venue', 'id', 'name', 'location', 'city',
  'league', 'id', 'name',
].join(',')

export async function getGame(gamePk: number): Promise<ScheduleResponse['dates'][0]['games'][0] | null> {
  const res = await mlbApi.get<ScheduleResponse>('/schedule', {
    sportId: 1,
    gamePks: gamePk,
    hydrate: 'probablePitcher,linescore,weather,venue(location),team(league)',
    fields: GAME_FIELDS,
  })
  // Rescheduled make-up games appear in two dates[] entries: the original postponed
  // date first, then the actual new date. Skip Postponed entries to get the real game.
  const allGames = (res.dates ?? []).flatMap(d => d.games)
  const activeGame = allGames.find(g => g.status?.detailedState !== 'Postponed')
  return activeGame ?? allGames[allGames.length - 1] ?? null
}

export function getTodaySchedule(): Promise<ScheduleResponse> {
  const today = new Date().toISOString().split('T')[0]
  return getSchedule({ date: today, hydrate: ['probablePitcher', 'linescore'] })
}

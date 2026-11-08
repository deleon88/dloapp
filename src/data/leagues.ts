// Leagues the schedule can show, with the Stats API parameters that select
// them. MLB goes by sportId; LIDOM by leagueId, since it shares sportId 17
// (Winter Leagues) with the LVBP and the LMP. Same ids as server/leagues.ts.
import { isLidomTeam } from './teams'

export type LeagueKey = 'MLB' | 'LIDOM'

export const LEAGUE_PARAMS: Record<LeagueKey, { sportId: number; leagueId?: number }> = {
  MLB:   { sportId: 1 },
  LIDOM: { sportId: 17, leagueId: 131 },
}

export const LEAGUE_KEYS = Object.keys(LEAGUE_PARAMS) as LeagueKey[]

/** `?league=lidom` → 'LIDOM'; anything else is MLB. */
export function parseLeague(value: string | null): LeagueKey {
  return value?.toUpperCase() === 'LIDOM' ? 'LIDOM' : 'MLB'
}

/** League of a game, from its home team. */
export function leagueOfGame(game: { teams: { home: { team: { id: number } } } }): LeagueKey {
  return isLidomTeam(game.teams.home.team.id) ? 'LIDOM' : 'MLB'
}

/**
 * Season a date belongs to. A winter season carries the year it starts in:
 * LIDOM games in January 2027 are season 2026.
 */
export function leagueSeason(league: LeagueKey, date: string): number {
  const year = Number(date.slice(0, 4))
  return league === 'LIDOM' && Number(date.slice(5, 7)) < 7 ? year - 1 : year
}

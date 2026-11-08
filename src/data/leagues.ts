// Leagues the schedule can show, with the Stats API parameters that select
// them. MLB goes by sportId; LIDOM by leagueId, since it shares sportId 17
// (Winter Leagues) with the LVBP and the LMP. Same ids as server/leagues.ts.
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

/** League of a team, from its Stats API league id (team(league) hydrate). */
export function leagueOfLeagueId(leagueId: number | undefined): LeagueKey {
  return leagueId === LEAGUE_PARAMS.LIDOM.leagueId ? 'LIDOM' : 'MLB'
}

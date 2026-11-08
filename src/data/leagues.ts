// The leagues the app covers, grouped by sport. Every page lives under its
// league (/lidom/games, /mlb/stats...), and pages ask a league's capabilities
// instead of checking which league it is. A new league is one more entry; a
// new sport adds its entry to SPORTS and its own data sources.
// Stats API ids: MLB goes by sportId; LIDOM by leagueId, since it shares
// sportId 17 (Winter Leagues) with the LVBP and the LMP. Same ids as
// server/leagues.ts.
import { isLidomTeam } from './teams'

export type LeagueKey = 'MLB' | 'LIDOM'
export type SportKey = 'baseball'

export interface LeagueInfo {
  key: LeagueKey
  /** URL segment: /lidom/games */
  slug: string
  name: string
  fullName: string
  sport: SportKey
  sportId: number
  leagueId?: number
  logo: string
  /** Rough season window (MM-DD, inclusive; may wrap past New Year), to pick a default league. */
  season: { from: string; to: string }
  /** What its data supports. */
  caps: {
    /** Announced probable starters (otherwise starters show once the game is on). */
    probables: boolean
    /** Projected starters and go-to lineups, from the team's own history. */
    projections: boolean
    /** Depth charts and what's built on them (opener roles, the bullpen card and its bar). */
    depthCharts: boolean
    /** AL / NL style sub-leagues on the Stats page. */
    subLeagues: boolean
  }
}

export const SPORTS: Array<{ key: SportKey; name: string; icon: string }> = [
  { key: 'baseball', name: 'Baseball', icon: 'ball-baseball' },
]

export const LEAGUES: LeagueInfo[] = [
  {
    key: 'MLB', slug: 'mlb', name: 'MLB', fullName: 'Major League Baseball', sport: 'baseball',
    sportId: 1, logo: 'https://www.mlbstatic.com/team-logos/league-on-dark/1.svg',
    season: { from: '03-15', to: '11-05' },
    caps: { probables: true, projections: true, depthCharts: true, subLeagues: true },
  },
  {
    key: 'LIDOM', slug: 'lidom', name: 'LIDOM', fullName: 'Liga de Béisbol Dominicano', sport: 'baseball',
    sportId: 17, leagueId: 131, logo: 'https://www.mlbstatic.com/team-logos/league-on-dark/131.svg',
    season: { from: '10-10', to: '02-05' },
    caps: { probables: false, projections: true, depthCharts: false, subLeagues: false },
  },
]

/** Leagues on the way: listed in the league picker, locked (no date promised). */
export const LOCKED_LEAGUES: Array<Pick<LeagueInfo, 'name' | 'fullName' | 'sport' | 'logo'>> = [
  { name: 'LMB', fullName: 'Liga Mexicana de Béisbol', sport: 'baseball', logo: 'https://www.mlbstatic.com/team-logos/league-on-dark/125.svg' },
]

const byKey = new Map(LEAGUES.map(l => [l.key, l]))
const bySlug = new Map(LEAGUES.map(l => [l.slug, l]))

export function leagueInfo(key: LeagueKey): LeagueInfo {
  return byKey.get(key)!
}

export function leagueBySlug(slug: string | undefined): LeagueInfo | undefined {
  return slug ? bySlug.get(slug.toLowerCase()) : undefined
}

/** Stats API parameters that select the league's games: { sportId, leagueId? }. */
export function leagueParams(key: LeagueKey): { sportId: number; leagueId?: number } {
  const { sportId, leagueId } = leagueInfo(key)
  return leagueId ? { sportId, leagueId } : { sportId }
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

/** Whether the date (YYYY-MM-DD) falls in the league's season window. */
export function inSeason(league: LeagueKey, date: string): boolean {
  const { from, to } = leagueInfo(league).season
  const md = date.slice(5)
  return from <= to ? md >= from && md <= to : md >= from || md <= to
}

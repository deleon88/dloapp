// Ligas que ingresamos del Stats API. MLB se pide por sportId (trae la AL y la
// NL); las demás por leagueId, porque comparten sportId con otras ligas: LIDOM,
// LVBP y LMP son todas sportId 17 (Winter Leagues). La LMB es sportId 23 desde
// 2021; hasta 2020 estaba en Triple-A (sportId 11).
export type League = 'MLB' | 'LIDOM' | 'LMB'

export const LEAGUES: Record<League, { sportId: number; leagueId?: number }> = {
  MLB:   { sportId: 1 },
  LIDOM: { sportId: 17, leagueId: 131 },
  LMB:   { sportId: 23, leagueId: 125 },
}

/** Leagues whose calendar and play-by-play we keep (daily cron, picks results). */
export const SYNCED_LEAGUES: League[] = ['MLB', 'LIDOM']

/** League of a team from its Stats API league id (team(league) hydrate): AL / NL are MLB. */
export function leagueOfLeagueId(leagueId: number | undefined): League {
  return (Object.keys(LEAGUES) as League[]).find(l => LEAGUES[l].leagueId === leagueId) ?? 'MLB'
}

export function isLeague(x: string): x is League {
  return Object.keys(LEAGUES).includes(x)
}

/** Parámetros de /schedule y /stats para la liga: `sportId=17&leagueId=131`. */
export function leagueParams(league: League): string {
  const { sportId, leagueId } = LEAGUES[league]
  return `sportId=${sportId}${leagueId ? `&leagueId=${leagueId}` : ''}`
}

/** Lo mismo para /teams/stats, que los pide en plural: `sportIds=17&leagueIds=131`. */
export function leagueTeamStatsParams(league: League): string {
  const { sportId, leagueId } = LEAGUES[league]
  return `sportIds=${sportId}${leagueId ? `&leagueIds=${leagueId}` : ''}`
}

/**
 * Fuente de las constantes de la liga en league_constants: 're24' para MLB
 * (la de siempre), 're24-lidom' para LIDOM.
 */
export function constantsSource(league: League): string {
  return league === 'MLB' ? 're24' : `re24-${league.toLowerCase()}`
}

/** Temporada en curso en esa fecha: la de invierno lleva el año en que empieza (enero de 2027 = 2026). */
export function leagueSeasonOf(league: League, date: string): number {
  const year = Number(date.slice(0, 4))
  return league === 'LIDOM' && Number(date.slice(5, 7)) < 7 ? year - 1 : year
}

/**
 * Fechas que cubren una temporada completa con postemporada. La temporada de
 * invierno lleva el año en que empieza: LIDOM 2026 va de octubre de 2026 a
 * la final de enero de 2027, y la API la marca como season 2026.
 */
export function seasonRange(league: League, season: number): { start: string; end: string } {
  switch (league) {
    case 'MLB':   return { start: `${season}-02-01`, end: `${season}-11-30` }
    case 'LMB':   return { start: `${season}-03-01`, end: `${season}-10-31` }
    case 'LIDOM': return { start: `${season}-09-01`, end: `${season + 1}-02-28` }
  }
}

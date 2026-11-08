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

export function isLeague(x: string): x is League {
  return Object.keys(LEAGUES).includes(x)
}

/** Parámetros de /schedule y /stats para la liga: `sportId=17&leagueId=131`. */
export function leagueParams(league: League): string {
  const { sportId, leagueId } = LEAGUES[league]
  return `sportId=${sportId}${leagueId ? `&leagueId=${leagueId}` : ''}`
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

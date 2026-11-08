// The league a page is about: the /:league segment of the URL. Pages outside
// a league (player, profile...) get the last one picked, so the nav still
// shows it. The pick is remembered per browser; it only picks the default.
import { useLocation } from 'react-router-dom'
import { inSeason, LEAGUES, leagueBySlug, leagueInfo, type LeagueInfo, type LeagueKey } from '@/data/leagues'
import { mlbToday } from './etDate'

const STORAGE_KEY = 'dlo.league'

export type LeaguePage = 'games' | 'stats' | 'ranking'

function storedLeague(): LeagueKey | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return LEAGUES.some(l => l.key === v) ? v as LeagueKey : null
  } catch {
    return null
  }
}

export function rememberLeague(key: LeagueKey): void {
  try { localStorage.setItem(STORAGE_KEY, key) } catch { /* private mode: nothing to remember */ }
}

/**
 * League to open with no league in the URL: the last one picked while it's in
 * season; otherwise the first league in season (MLB in summer, LIDOM in
 * winter); otherwise the last one picked, or MLB.
 */
export function defaultLeague(today = mlbToday()): LeagueKey {
  const last = storedLeague()
  if (last && inSeason(last, today)) return last
  return LEAGUES.find(l => inSeason(l.key, today))?.key ?? last ?? 'MLB'
}

/** Path of a league page: /lidom/games, /mlb/game/123. */
export function leaguePath(key: LeagueKey, page: LeaguePage | `game/${number}`): string {
  return `/${leagueInfo(key).slug}/${page}`
}

/**
 * The page's league: the URL's first segment, or the default outside league
 * pages. Read from the path, not the route params, so the nav bar (outside
 * the league routes) sees it too.
 */
export function useLeague(): LeagueInfo {
  const { pathname } = useLocation()
  return leagueBySlug(pathname.split('/')[1]) ?? leagueInfo(defaultLeague())
}

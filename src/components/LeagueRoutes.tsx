// Routing around the /:league segment: the scope of the league pages, and the
// redirects that send league-less paths (/, /schedule, /stats...) to one.
import { useEffect } from 'react'
import { Navigate, Outlet, useParams, useSearchParams } from 'react-router-dom'
import { leagueBySlug } from '@/data/leagues'
import { defaultLeague, leaguePath, rememberLeague, type LeaguePage } from '@/utils/useLeague'

/** Parent of /:league/* routes: an unknown league goes to the default one's games; a known one is remembered. */
export function LeagueScope() {
  const { league } = useParams<{ league: string }>()
  const info = leagueBySlug(league)
  useEffect(() => { if (info) rememberLeague(info.key) }, [info])
  if (!info) return <Navigate to={leaguePath(defaultLeague(), 'games')} replace />
  // Keyed by league: switching leagues starts each page fresh (date, filters, season)
  return <Outlet key={info.key} />
}

/**
 * A page without a league in the path (old links, bookmarks): the same page of
 * the default league. The old `?league=lidom` of the schedule is honored.
 */
export function LeagueRedirect({ page }: { page: LeaguePage }) {
  const [params] = useSearchParams()
  const asked = leagueBySlug(params.get('league') ?? undefined)
  return <Navigate to={leaguePath(asked?.key ?? defaultLeague(), page)} replace />
}

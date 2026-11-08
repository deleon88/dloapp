// GET /api/rankings?period=today|week|month|season[&league=MLB|LIDOM] → picks leaderboard of the league (public).
import { getRankings, refreshRecentResults, type RankingPeriod } from '../server/votes.js'
import { isLeague } from '../server/leagues.js'

const PERIODS = new Set<string>(['today', 'week', 'month', 'season'])

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  const period = q.get('period') ?? 'week'
  if (!PERIODS.has(period)) return Response.json({ error: 'period debe ser today, week, month o season' }, { status: 400 })
  const league = (q.get('league') ?? 'MLB').toUpperCase()
  if (!isLeague(league)) return Response.json({ error: 'league debe ser MLB, LIDOM o LMB' }, { status: 400 })
  try {
    await refreshRecentResults()
    const data = await getRankings(period as RankingPeriod, league)
    return Response.json({ period, league, ...data }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (e) {
    console.error('[api/rankings]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

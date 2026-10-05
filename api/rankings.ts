// GET /api/rankings?period=today|week|month|season → picks leaderboard (public).
import { getRankings, refreshRecentResults, type RankingPeriod } from '../server/votes.js'

const PERIODS = new Set<string>(['today', 'week', 'month', 'season'])

export async function GET(request: Request): Promise<Response> {
  const period = new URL(request.url).searchParams.get('period') ?? 'week'
  if (!PERIODS.has(period)) return Response.json({ error: 'period debe ser today, week, month o season' }, { status: 400 })
  try {
    await refreshRecentResults()
    const data = await getRankings(period as RankingPeriod)
    return Response.json({ period, ...data }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch (e) {
    console.error('[api/rankings]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

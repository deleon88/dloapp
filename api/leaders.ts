// GET /api/leaders?type=bat|pit|team[&season=2026][&period=season|60days|30days|14days|7days]
//                  [&hand=L|R][&role=all|sp|rp][&league=MLB|LIDOM]
// Leaderboards for the Stats page: every batter / pitcher / team with its whole
// line. hand = opposing pitcher's hand for batters, batter's hand for pitchers
// (teams: each side). role = pitching only as starter / in relief.
import { PERIOD_DAYS, resolvePeriod, type Period } from '../server/stats/batting.js'
import { getBattingLeaders, getPitchingLeaders, getTeamLeaders, type Hand, type Role } from '../server/leaders/leaders.js'
import { isLeague } from '../server/leagues.js'

export const maxDuration = 30

const TYPES = new Set(['bat', 'pit', 'team'])
const PERIODS = new Set<string>(['season', ...Object.keys(PERIOD_DAYS)])
const ROLES = new Set(['all', 'sp', 'rp'])

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams

  const type = q.get('type') ?? ''
  if (!TYPES.has(type)) return bad('type debe ser bat, pit o team')
  const season = Number(q.get('season') ?? new Date().getFullYear())
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')
  const period = q.get('period') ?? 'season'
  if (!PERIODS.has(period)) return bad(`period debe ser uno de: ${[...PERIODS].join(', ')}`)
  const handParam = q.get('hand')
  if (handParam && handParam !== 'L' && handParam !== 'R') return bad('hand debe ser L o R')
  const role = q.get('role') ?? 'all'
  if (!ROLES.has(role)) return bad('role debe ser all, sp o rp')
  const league = (q.get('league') ?? 'MLB').toUpperCase()
  if (!isLeague(league)) return bad('league debe ser MLB, LIDOM o LMB')

  try {
    const range = await resolvePeriod(season, period as Period, league)
    const f = { league, season, ...range, hand: (handParam ?? undefined) as Hand | undefined, role: role as Role }
    const data = type === 'bat' ? await getBattingLeaders(f)
      : type === 'pit' ? await getPitchingLeaders(f)
      : await getTeamLeaders(f)
    return Response.json(
      { type, league, season, period, hand: f.hand ?? null, role, from: range.from ?? null, to: range.to ?? null, ...data },
      // Changes only when the daily ingest runs: the CDN can serve it.
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    )
  } catch (e) {
    console.error('[api/leaders]', e)
    return Response.json({ error: 'Error al consultar la base' }, { status: 500 })
  }
}

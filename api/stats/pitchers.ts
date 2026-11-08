// GET /api/stats/pitchers?ids=1,2,3[&season=2026][&period=season|60days|30days|14days|7days][&role=all|rp][&league=MLB|LIDOM]
// FIP, FIP-, xFIP, WHIP, K-BB% and wOBA against (overall, vs LHB, vs RHB) from
// the play-by-play, plus ERA / W-L / QS from MLB for the same period.
// GET /api/stats/pitchers?teams=667,668&role=rp[&season][&period][&league]: each team's relief line
// GET /api/stats/pitchers?guide=1[&season=2026][&league]: league averages + tiers for the pitcher card guide
import { PERIOD_DAYS, resolvePeriod, type Period } from '../../server/stats/batting.js'
import { getPitcherLines, getTeamReliefLines, type PitcherRole } from '../../server/stats/pitching.js'
import { isLeague } from '../../server/leagues.js'
import { getPitcherRecords } from '../../server/mlb/pitcherRecord.js'
import { getPitchingGuide } from '../../server/stats/pitchingGuide.js'

const MAX_IDS = 200
const PERIODS = new Set<string>(['season', ...Object.keys(PERIOD_DAYS)])
const ROLES = new Set<string>(['all', 'rp'])

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams

  // ?guide=1[&season=]: league averages and tier cut-offs for the pitcher card's guide
  if (q.has('guide')) {
    const season = Number(q.get('season') ?? new Date().getFullYear())
    if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')
    const league = (q.get('league') ?? 'MLB').toUpperCase()
    if (!isLeague(league)) return bad('league debe ser MLB, LIDOM o LMB')
    try {
      return Response.json(await getPitchingGuide(season, league),
        { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } })
    } catch (e) {
      console.error('[api/stats/pitchers guide]', e)
      return Response.json({ error: 'Error al consultar la base' }, { status: 500 })
    }
  }

  const teams = (q.get('teams') ?? '').split(',').filter(Boolean).map(Number)
  const ids = (q.get('ids') ?? '').split(',').filter(Boolean).map(Number)
  if (!ids.length && !teams.length) return bad('ids o teams es obligatorio')
  if (ids.length > MAX_IDS || teams.length > MAX_IDS) return bad(`máximo ${MAX_IDS} ids por petición`)
  if ([...ids, ...teams].some(id => !Number.isInteger(id) || id <= 0)) return bad('ids inválidos')

  const season = Number(q.get('season') ?? new Date().getFullYear())
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')

  const period = q.get('period') ?? 'season'
  if (!PERIODS.has(period)) return bad(`period debe ser uno de: ${[...PERIODS].join(', ')}`)
  const role = (q.get('role') ?? 'all') as PitcherRole
  if (!ROLES.has(role)) return bad('role debe ser all o rp')
  const league = (q.get('league') ?? 'MLB').toUpperCase()
  if (!isLeague(league)) return bad('league debe ser MLB, LIDOM o LMB')
  if (teams.length && role !== 'rp') return bad('teams solo con role=rp')

  try {
    const range = await resolvePeriod(season, period as Period, league)
    if (teams.length) {
      const lines = await getTeamReliefLines({ league, season, teamIds: teams, ...range })
      return Response.json(
        { season, period, role, from: range.from ?? null, to: range.to ?? null, teams: Object.fromEntries(lines) },
        { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
      )
    }
    const [lines, records] = await Promise.all([
      getPitcherLines({ league, season, pitcherIds: ids, role, ...range }),
      // ERA etc. are informative only: if MLB fails, the rest still answers.
      getPitcherRecords({ league, season, pitcherIds: ids, ...range, reliefOnly: role === 'rp' }).catch(() => new Map()),
    ])
    const players = Object.fromEntries(ids.filter(id => lines.has(id)).map(id => [id, { ...lines.get(id), record: records.get(id) ?? null }]))
    return Response.json(
      { season, period, role, from: range.from ?? null, to: range.to ?? null, players },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    )
  } catch (e) {
    console.error('[api/stats/pitchers]', e)
    return Response.json({ error: 'Error al consultar la base' }, { status: 500 })
  }
}

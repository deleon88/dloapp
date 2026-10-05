// GET /api/bullpen?team=135[&season=2026][&period=season|60days|30days|14days|7days][&hand=all|L|R]
// The game page's bullpen card in one response: likely arms for today, their
// numbers for the period / batter hand, team totals and the pitch-count strip.
import { PERIOD_DAYS, type Period } from '../server/stats/batting.js'
import { getBullpen, type BullpenHand } from '../server/bullpen/bullpen.js'

const PERIODS = new Set<string>(['season', ...Object.keys(PERIOD_DAYS)])
const HANDS = new Set<string>(['all', 'L', 'R'])

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  const team = Number(q.get('team'))
  if (!Number.isInteger(team) || team <= 0) return bad('team es obligatorio')
  const season = Number(q.get('season') ?? new Date().getFullYear())
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')
  const period = q.get('period') ?? 'season'
  if (!PERIODS.has(period)) return bad(`period debe ser uno de: ${[...PERIODS].join(', ')}`)
  const hand = q.get('hand') ?? 'all'
  if (!HANDS.has(hand)) return bad('hand debe ser all, L o R')

  try {
    const bullpen = await getBullpen(team, { season, period: period as Period, hand: hand as BullpenHand })
    // Availability changes with roster moves and finished games: short cache,
    // served stale while it refreshes.
    return Response.json(bullpen, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
    })
  } catch (e) {
    console.error('[api/bullpen]', e)
    return Response.json({ error: 'No se pudo armar el bullpen' }, { status: 502 })
  }
}

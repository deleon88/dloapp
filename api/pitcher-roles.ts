// GET /api/pitcher-roles?ids=669373,605483&teams=147,139[&date=2026-10-08]
// Role of each probable starter: 'starter' or 'opener' (covers an inning or
// two before the bulk of the pitching). `teams` (same order as `ids`, optional)
// adds how often each one's team has used openers lately. With `date` (the
// game's date), each opener also gets `bulk`: the arm expected to pitch most
// of the game behind them, or null when it isn't clear enough to name.
// See server/openers/detect.ts and bulk.ts.
//
// GET /api/pitcher-roles?starters=2026-10-23
// Projected starters for that date's games with no announced probable:
// { games: { [gamePk]: { away?: {id, fullName}, home?: … } } } (server/starters).
import { getPitcherRoles } from '../server/openers/roles.js'
import { getBulkArm, type BulkArm } from '../server/openers/bulkService.js'
import { projectStarters } from '../server/starters/service.js'

const list = (s: string | null) => (s ?? '').split(',').filter(Boolean).map(Number)

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams

  const startersDate = q.get('starters')
  if (startersDate != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startersDate)) return Response.json({ error: 'starters debe ser YYYY-MM-DD' }, { status: 400 })
    try {
      const games = await projectStarters(startersDate)
      // Changes when probables are announced or a game is played: half an hour
      return Response.json({ date: startersDate, games }, {
        headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' },
      })
    } catch (e) {
      console.error('[api/pitcher-roles] starters:', e)
      return Response.json({ error: 'No se pudieron proyectar los abridores' }, { status: 500 })
    }
  }

  const ids = list(q.get('ids'))
  const teams = list(q.get('teams'))
  if (!ids.length || ids.length > 60 || ids.some(id => !Number.isInteger(id) || id <= 0)) {
    return Response.json({ error: 'ids es obligatorio (hasta 60)' }, { status: 400 })
  }
  if (teams.length && (teams.length !== ids.length || teams.some(t => !Number.isInteger(t) || t <= 0))) {
    return Response.json({ error: 'teams debe tener un equipo por cada id' }, { status: 400 })
  }
  try {
    const roles = await getPitcherRoles(ids.map((id, i) => ({ id, teamId: teams[i] })))
    const date = q.get('date')
    const bulk = new Map<number, BulkArm | null>()
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && teams.length) {
      await Promise.all(ids.map(async (id, i) => {
        if (roles.get(id)?.role !== 'opener') return
        bulk.set(id, await getBulkArm(teams[i], date, id).catch(e => {
          console.error(`[api/pitcher-roles] bulk ${id}:`, (e as Error).message)
          return null
        }))
      }))
    }
    for (const [id, b] of bulk) roles.set(id, { ...roles.get(id)!, bulk: b })
    // Changes only when a game is ingested (daily): long cache.
    return Response.json({ roles: Object.fromEntries(roles) }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    console.error('[api/pitcher-roles]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

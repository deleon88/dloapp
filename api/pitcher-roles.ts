// GET /api/pitcher-roles?ids=669373,605483&teams=147,139
// Role of each probable starter: 'starter' or 'opener' (covers an inning or
// two before the bulk of the pitching). `teams` (same order as `ids`, optional)
// adds how often each one's team has used openers lately.
// See server/openers/detect.ts.
import { getPitcherRoles } from '../server/openers/roles.js'

const list = (s: string | null) => (s ?? '').split(',').filter(Boolean).map(Number)

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
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
    // Changes only when a game is ingested (daily): long cache.
    return Response.json({ roles: Object.fromEntries(roles) }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    console.error('[api/pitcher-roles]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

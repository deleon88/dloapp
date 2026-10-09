// GET /api/pitcher-roles?ids=669373,605483
// Role of each probable starter: 'starter' or 'opener' (covers an inning or
// two before the bulk of the pitching). See server/openers/detect.ts.
import { getPitcherRoles } from '../server/openers/roles.js'

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('ids') ?? ''
  const ids = raw.split(',').filter(Boolean).map(Number)
  if (!ids.length || ids.length > 60 || ids.some(id => !Number.isInteger(id) || id <= 0)) {
    return Response.json({ error: 'ids es obligatorio (hasta 60)' }, { status: 400 })
  }
  try {
    const roles = await getPitcherRoles([...new Set(ids)])
    // Changes only when a game is ingested (daily): long cache.
    return Response.json({ roles: Object.fromEntries(roles) }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    console.error('[api/pitcher-roles]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}

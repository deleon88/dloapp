// GET /api/lineups?teams=147,111[&season=2026]   (sin teams: los 30 equipos)
// Lineup go-to de cada equipo vs abridor derecho (vsRHP) y zurdo (vsLHP): sus
// últimos 5 lineups contra esa mano, corregidos con roster activo, lesionados
// y depth chart. Ver server/lineups.
import { getGoTo, mlbTeamIds } from '../server/lineups/goTo.js'

// Recomputing all 30 teams (roster calls to MLB) can take a while when the cron hasn't.
export const maxDuration = 60

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams
  const season = Number(q.get('season') ?? new Date().getFullYear())
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')

  const raw = q.get('teams') ?? q.get('team')
  const teams = raw ? raw.split(',').map(Number) : null
  if (teams && (teams.length > 30 || teams.some(t => !Number.isInteger(t) || t <= 0))) return bad('teams inválido')

  try {
    const ids = teams ? [...new Set(teams)] : await mlbTeamIds()
    const goTo = await getGoTo(ids, season)
    // Roster moves happen during the day: short cache, served stale while it refreshes.
    return Response.json({ season, teams: goTo }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    })
  } catch (e) {
    console.error('[api/lineups]', e)
    return Response.json({ error: 'No se pudieron armar los lineups' }, { status: 502 })
  }
}

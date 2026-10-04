// GET /api/teams — MLB and LMB teams with their colors, plus (MLB) league,
// division, venue, roof type and FanGraphs park factor. Almost never changes:
// the CDN caches it for hours.
import { sql } from '../server/db.js'

interface TeamRow {
  league: 'MLB' | 'LMB'
  team_key: string
  abbr: string | null
  city: string | null
  nickname: string | null
  color: string
  color2: string
  bar_color: string | null
  cap_logo_variant: 'dark' | 'light'
  mlb_league_id: number | null
  division_id: number | null
  venue_id: number | null
  venue_name: string | null
  roof_type: string | null
  park_factor: number | null
}

export async function GET(): Promise<Response> {
  try {
    const season = new Date().getFullYear()
    const rows = await sql<TeamRow[]>`
      SELECT t.league, t.team_key, t.abbr, t.city, t.nickname, t.color, t.color2, t.bar_color,
             t.cap_logo_variant, t.mlb_league_id, t.division_id, t.venue_id,
             v.name AS venue_name, v.roof_type,
             pf.basic_5yr / 100.0 AS park_factor
      FROM teams t
      LEFT JOIN venues v USING (venue_id)
      LEFT JOIN LATERAL (
        SELECT basic_5yr FROM park_factors
        WHERE source = 'fangraphs' AND team_id::text = t.team_key AND season <= ${season}
        ORDER BY season DESC LIMIT 1
      ) pf ON t.league = 'MLB'
      ORDER BY t.league, t.team_key
    `
    const mlb = rows.filter(r => r.league === 'MLB').map(r => ({
      id: Number(r.team_key),
      abbr: r.abbr ?? '',
      name: r.city ?? '',
      brief: r.nickname ?? '',
      color: r.color,
      color2: r.color2,
      ...(r.bar_color ? { barColor: r.bar_color } : {}),
      capLogoVariant: r.cap_logo_variant,
      leagueId: r.mlb_league_id,
      divisionId: r.division_id,
      park: r.venue_id
        ? { venueId: r.venue_id, name: r.venue_name, roofType: r.roof_type, factor: r.park_factor != null ? Number(r.park_factor) : null }
        : null,
    }))
    const lmb = rows.filter(r => r.league === 'LMB').map(r => ({
      code: r.team_key, name: r.nickname ?? '', color: r.color, color2: r.color2,
    }))
    return Response.json(
      { mlb, lmb },
      { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=604800' } },
    )
  } catch (e) {
    console.error('[api/teams]', e)
    return Response.json({ error: 'Error al consultar la base' }, { status: 500 })
  }
}

// Loads db/seeds/teams.csv (visual identity of MLB and LMB teams) into the
// teams table, and fills league, division and venue (with roof type) for MLB
// teams from the MLB Stats API.
// Usage: npm run db:seed-teams -- [--season 2026]
// To change a color or a name: edit the CSV and run it again.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { getJson } from '../../server/mlb/pbp'

const { values } = parseArgs({ options: { season: { type: 'string', default: String(new Date().getFullYear()) } } })
const season = Number(values.season)

// ── CSV ───────────────────────────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

const csv = await readFile(new URL('../../db/seeds/teams.csv', import.meta.url), 'utf-8')
const [header, ...lines] = csv.trim().split(/\r?\n/)
const cols = parseCsvLine(header)
const csvRows = lines.map(l => Object.fromEntries(parseCsvLine(l).map((v, i) => [cols[i], v || null])))

// ── MLB metadata: league, division, venue + roof type ────────────────────────
interface RawTeam {
  id: number
  league?: { id: number }
  division?: { id: number }
  venue?: { id: number; name: string; fieldInfo?: { roofType?: string } }
}
const mlb = await getJson<{ teams: RawTeam[] }>(
  `https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${season}&hydrate=venue(fieldInfo)`,
)
const mlbById = new Map(mlb.teams.map(t => [String(t.id), t]))

const venues = mlb.teams
  .filter(t => t.venue)
  .map(t => ({ venue_id: t.venue!.id, name: t.venue!.name, roof_type: t.venue!.fieldInfo?.roofType ?? null }))

const teams = csvRows.map(r => {
  const m = r.league === 'MLB' ? mlbById.get(r.team_key!) : undefined
  return {
    league: r.league,
    team_key: r.team_key,
    abbr: r.abbr,
    city: r.city,
    nickname: r.nickname,
    color: r.color,
    color2: r.color2,
    bar_color: r.bar_color,
    cap_logo_variant: r.cap_logo_variant ?? 'dark',
    mlb_league_id: m?.league?.id ?? null,
    division_id: m?.division?.id ?? null,
    venue_id: m?.venue?.id ?? null,
  }
})

await sql.begin(async tx => {
  await tx`
    INSERT INTO venues ${tx(venues)}
    ON CONFLICT (venue_id) DO UPDATE SET name = EXCLUDED.name, roof_type = EXCLUDED.roof_type, updated_at = now()
  `
  await tx`
    INSERT INTO teams ${tx(teams)}
    ON CONFLICT (league, team_key) DO UPDATE SET
      abbr = EXCLUDED.abbr, city = EXCLUDED.city, nickname = EXCLUDED.nickname,
      color = EXCLUDED.color, color2 = EXCLUDED.color2, bar_color = EXCLUDED.bar_color,
      cap_logo_variant = EXCLUDED.cap_logo_variant, mlb_league_id = EXCLUDED.mlb_league_id,
      division_id = EXCLUDED.division_id, venue_id = EXCLUDED.venue_id, updated_at = now()
  `
})
const missing = teams.filter(t => t.league === 'MLB' && !t.venue_id && !['159', '160'].includes(t.team_key!))
console.log(`${venues.length} estadios y ${teams.length} equipos guardados (${teams.filter(t => t.league === 'MLB').length} MLB, ${teams.filter(t => t.league === 'LMB').length} LMB).`)
if (missing.length) console.log('Equipos de MLB sin estadio:', missing.map(t => t.team_key).join(', '))
await sql.end()

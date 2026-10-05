// Estadísticas de bateo calculadas desde la tabla plays: conteos por bateador
// filtrables por temporada, ventana de fechas y mano del pitcher, más wOBA y
// wRC+ con las constantes de league_constants.
import { sql } from '../db.js'
import { woba, wrcPlus, type WobaConstants } from './formulas.js'

// Re-exported so existing importers (scripts, pitching.ts) keep working.
export { woba, wrcPlus, type WobaConstants }

// Turnos que no cuentan como turno oficial (AB). La interferencia del bateador
// sí es AB (el bateador queda out), a diferencia de la del receptor.
const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference']

export interface BatterCounts {
  batter_id: number
  pa: number
  ab: number
  h1: number
  h2: number
  h3: number
  hr: number
  ubb: number
  ibb: number
  hbp: number
  sf: number
  so: number
  rbi: number
}

export interface BatterFilter {
  season: number
  batterIds?: number[]
  from?: string           // YYYY-MM-DD inclusive
  to?: string             // YYYY-MM-DD inclusive
  vsHand?: 'L' | 'R'      // mano del pitcher
  teamId?: number         // solo turnos jugando para este equipo
}

// Columnas de conteo compartidas por todas las consultas de bateo.
function countColumns() {
  return sql`
    count(*)::int                                                              AS pa,
    count(*) FILTER (WHERE NOT (p.event = ANY(${NON_AB})))::int                AS ab,
    count(*) FILTER (WHERE p.event = 'Single')::int                            AS h1,
    count(*) FILTER (WHERE p.event = 'Double')::int                            AS h2,
    count(*) FILTER (WHERE p.event = 'Triple')::int                            AS h3,
    count(*) FILTER (WHERE p.event = 'Home Run')::int                          AS hr,
    count(*) FILTER (WHERE p.event = 'Walk')::int                              AS ubb,
    count(*) FILTER (WHERE p.event = 'Intent Walk')::int                       AS ibb,
    count(*) FILTER (WHERE p.event = 'Hit By Pitch')::int                      AS hbp,
    count(*) FILTER (WHERE p.event IN ('Sac Fly', 'Sac Fly Double Play'))::int AS sf,
    count(*) FILTER (WHERE p.event IN ('Strikeout', 'Strikeout Double Play'))::int AS so,
    coalesce(sum(p.rbi), 0)::int                                               AS rbi
  `
}

// Equipo para el que batea en esa jugada: visitante en la alta, local en la baja.
function battingTeam() {
  return sql`(CASE WHEN p.half = 't' THEN g.away_team_id ELSE g.home_team_id END)`
}

function whereClause(f: BatterFilter) {
  return sql`
    WHERE g.season = ${f.season}
      AND g.game_type = 'R'
      AND p.is_pa
      ${f.batterIds ? sql`AND p.batter_id = ANY(${f.batterIds})` : sql``}
      ${f.from ? sql`AND p.game_date >= ${f.from}` : sql``}
      ${f.to ? sql`AND p.game_date <= ${f.to}` : sql``}
      ${f.vsHand ? sql`AND p.pitch_hand = ${f.vsHand}` : sql``}
      ${f.teamId ? sql`AND ${battingTeam()} = ${f.teamId}` : sql``}
  `
}

export async function getBatterCounts(f: BatterFilter): Promise<BatterCounts[]> {
  return sql<BatterCounts[]>`
    SELECT p.batter_id, ${countColumns()}
    FROM plays p JOIN games g USING (game_pk)
    ${whereClause(f)}
    GROUP BY p.batter_id
  `
}

type SplitRow = BatterCounts & { team_id: number; pitch_hand: string | null }

/** Conteos por bateador, equipo y mano del pitcher: la base para ponderar el park factor. */
function getBatterSplitRows(f: Omit<BatterFilter, 'vsHand' | 'teamId'>) {
  return sql<SplitRow[]>`
    SELECT p.batter_id, ${battingTeam()} AS team_id, p.pitch_hand, ${countColumns()}
    FROM plays p JOIN games g USING (game_pk)
    ${whereClause(f)}
    GROUP BY 1, 2, 3
  `
}

/** Constantes de la temporada; si aún no existen (inicio de año), las más recientes anteriores. */
export async function getConstants(season: number, source = 're24'): Promise<WobaConstants> {
  const [row] = await sql<{ constants: WobaConstants }[]>`
    SELECT constants FROM league_constants
    WHERE source = ${source} AND season <= ${season}
    ORDER BY season DESC LIMIT 1
  `
  if (!row) throw new Error(`No hay constantes ${source} para ${season} (npm run db:constants -- --season ${season} --save)`)
  return row.constants
}

/** Factor de parque básico (1.00 = neutral) por equipo local; usa la temporada más reciente ≤ season. */
export async function getParkFactors(season: number, source = 'fangraphs'): Promise<Map<number, number>> {
  const rows = await sql<{ team_id: number; basic_5yr: number }[]>`
    SELECT DISTINCT ON (team_id) team_id, basic_5yr
    FROM park_factors
    WHERE source = ${source} AND season <= ${season}
    ORDER BY team_id, season DESC
  `
  return new Map(rows.map(r => [r.team_id, r.basic_5yr / 100]))
}

// ── Periodos ─────────────────────────────────────────────────────────────────

export const PERIOD_DAYS = { '60days': 60, '30days': 30, '14days': 14, '7days': 7 } as const
export type Period = 'season' | keyof typeof PERIOD_DAYS

/**
 * Rango de fechas de un periodo. Las ventanas terminan en el último día con
 * juegos de temporada regular ya cargados, no en hoy: así "últimos 7 días"
 * sigue teniendo datos en la postemporada o el día después de un día libre.
 */
export async function resolvePeriod(season: number, period: Period): Promise<{ from?: string; to?: string }> {
  if (period === 'season') return {}
  const [row] = await sql<{ last: string | null }[]>`
    SELECT to_char(max(game_date), 'YYYY-MM-DD') AS last
    FROM games
    WHERE season = ${season} AND game_type = 'R' AND pbp_ingested_at IS NOT NULL
  `
  if (!row?.last) return {}
  const to = new Date(`${row.last}T00:00:00Z`)
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - (PERIOD_DAYS[period] - 1))
  return { from: from.toISOString().slice(0, 10), to: row.last }
}

// ── Líneas listas para la app ─────────────────────────────────────────────────

export interface SplitLine {
  pa: number
  woba: number | null
  wrcPlus: number | null
  ops: number | null
  hr: number
  rbi: number
}

function ops(b: BatterCounts): number | null {
  const bb = b.ubb + b.ibb
  const obpDen = b.ab + bb + b.hbp + b.sf
  if (!obpDen || !b.ab) return null
  const hits = b.h1 + b.h2 + b.h3 + b.hr
  const obp = (hits + bb + b.hbp) / obpDen
  const slg = (b.h1 + 2 * b.h2 + 3 * b.h3 + 4 * b.hr) / b.ab
  return obp + slg
}

export interface BatterLine extends SplitLine {
  vsL: SplitLine
  vsR: SplitLine
}

const COUNT_KEYS = ['pa', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'rbi'] as const

/**
 * wOBA y wRC+ (general, vs LHP, vs RHP) por bateador. Suma todos sus equipos y
 * pondera el park factor por los turnos que dio con cada uno, así un jugador
 * traspasado queda ajustado por los parques donde realmente jugó.
 */
export async function getBatterLines(f: Omit<BatterFilter, 'vsHand' | 'teamId'>): Promise<Map<number, BatterLine>> {
  const [rows, c, parks] = await Promise.all([
    getBatterSplitRows(f),
    getConstants(f.season),
    getParkFactors(f.season),
  ])

  type Acc = { counts: BatterCounts; pfPa: number }
  const empty = (id: number): Acc => ({
    counts: { batter_id: id, pa: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0, so: 0, rbi: 0 },
    pfPa: 0,
  })
  const acc = new Map<number, { all: Acc; L: Acc; R: Acc }>()

  for (const r of rows) {
    let a = acc.get(r.batter_id)
    if (!a) acc.set(r.batter_id, a = { all: empty(r.batter_id), L: empty(r.batter_id), R: empty(r.batter_id) })
    const pf = parks.get(r.team_id) ?? 1
    const targets = [a.all, r.pitch_hand === 'L' ? a.L : r.pitch_hand === 'R' ? a.R : null]
    for (const t of targets) {
      if (!t) continue
      for (const k of COUNT_KEYS) t.counts[k] += r[k]
      t.pfPa += pf * r.pa
    }
  }

  const line = ({ counts, pfPa }: Acc): SplitLine => {
    const w = counts.pa ? woba(counts, c) : null
    const wrc = counts.pa ? wrcPlus(counts, c, pfPa / counts.pa) : null
    const o = ops(counts)
    return {
      pa: counts.pa,
      woba: w == null ? null : Math.round(w * 1000) / 1000,
      wrcPlus: wrc == null ? null : Math.round(wrc),
      ops: o == null ? null : Math.round(o * 1000) / 1000,
      hr: counts.hr,
      rbi: counts.rbi,
    }
  }

  const out = new Map<number, BatterLine>()
  for (const [id, a] of acc) out.set(id, { ...line(a.all), vsL: line(a.L), vsR: line(a.R) })
  return out
}

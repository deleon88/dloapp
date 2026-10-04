// Constantes wOBA por RE24, calculadas en SQL sobre la tabla plays.
// Basado en scripts/compute_linear_weights.py (paridad exacta verificada), con
// dos ajustes calibrados contra las constantes publicadas por FanGraphs en
// 2025 y 2026 (ver scripts/db/calibrate.ts):
//   - wOBA de liga = OBP de liga SIN intencionales (así lo ancla FanGraphs).
//   - Valor del out = promedio de los outs en juego, no solo el del rodado.
// Uso: npm run db:constants -- --season 2026 [--save]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    save: { type: 'boolean', default: false },
  },
})
const season = Number(values.season)

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference', 'Batter Interference']

// Valor en carreras de cada evento: RE(después) − RE(antes) + carreras anotadas.
const runValues = await sql<{ event: string; n: number; lw: number }[]>`
  WITH season_plays AS (
    SELECT p.*
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${season} AND g.game_type = 'R'
  ),
  -- Carreras desde esta jugada hasta el final de la media entrada (incluye jugadas sin turno).
  remaining AS (
    SELECT *, sum(runs_scored) OVER (
      PARTITION BY game_pk, inning, half ORDER BY at_bat_index
      ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
    ) AS runs_rem
    FROM season_plays
  ),
  re24 AS (
    SELECT pre_outs, on_1b, on_2b, on_3b, avg(runs_rem) AS re
    FROM remaining WHERE is_pa
    GROUP BY 1, 2, 3, 4
  ),
  pa AS (
    SELECT *,
      lead(pre_outs) OVER w AS nx_outs, lead(on_1b) OVER w AS nx_1b,
      lead(on_2b)    OVER w AS nx_2b,   lead(on_3b) OVER w AS nx_3b
    FROM season_plays WHERE is_pa
    WINDOW w AS (PARTITION BY game_pk, inning, half ORDER BY at_bat_index)
  )
  SELECT pa.event, count(*)::int AS n,
         avg(coalesce(post.re, 0) - coalesce(pre.re, 0) + pa.runs_scored)::float8 AS lw
  FROM pa
  LEFT JOIN re24 pre  ON (pre.pre_outs, pre.on_1b, pre.on_2b, pre.on_3b) = (pa.pre_outs, pa.on_1b, pa.on_2b, pa.on_3b)
  LEFT JOIN re24 post ON (post.pre_outs, post.on_1b, post.on_2b, post.on_3b) = (pa.nx_outs, pa.nx_1b, pa.nx_2b, pa.nx_3b)
  GROUP BY pa.event
`

const [t] = await sql<Record<string, number>[]>`
  SELECT
    count(*)::int                                                         AS pa,
    sum(p.runs_scored)::int                                               AS runs,
    count(*) FILTER (WHERE NOT (p.event = ANY(${NON_AB})))::int           AS ab,
    count(*) FILTER (WHERE p.event = 'Single')::int                       AS h1,
    count(*) FILTER (WHERE p.event = 'Double')::int                       AS h2,
    count(*) FILTER (WHERE p.event = 'Triple')::int                       AS h3,
    count(*) FILTER (WHERE p.event = 'Home Run')::int                     AS hr,
    count(*) FILTER (WHERE p.event IN ('Walk', 'Intent Walk'))::int       AS bb,
    count(*) FILTER (WHERE p.event = 'Intent Walk')::int                  AS ibb,
    count(*) FILTER (WHERE p.event = 'Hit By Pitch')::int                 AS hbp,
    count(*) FILTER (WHERE p.event IN ('Sac Fly', 'Sac Fly Double Play'))::int AS sf,
    count(DISTINCT p.game_pk)::int                                        AS games
  FROM plays p JOIN games g USING (game_pk)
  WHERE g.season = ${season} AND g.game_type = 'R' AND p.is_pa
`

const lw = Object.fromEntries(runValues.map(r => [r.event, r.lw]))
// Valor del out: promedio (ponderado por frecuencia) de los outs en juego. Es
// la regla que mejor reproduce a FanGraphs en 2025 y 2026 (−0.248 / −0.251,
// contra un óptimo de −0.244 / −0.246). El script de Python usaba solo el rodado.
const BIP_OUTS = ['Groundout', 'Flyout', 'Lineout', 'Pop Out', 'Forceout', 'Fielders Choice Out']
const outRows = runValues.filter(r => BIP_OUTS.includes(r.event))
const lwOut = outRows.reduce((s, r) => s + r.lw * r.n, 0) / outRows.reduce((s, r) => s + r.n, 0)
const c = {
  wBB: lw['Walk'] - lwOut, wHBP: lw['Hit By Pitch'] - lwOut, w1B: lw['Single'] - lwOut,
  w2B: lw['Double'] - lwOut, w3B: lw['Triple'] - lwOut, wHR: lw['Home Run'] - lwOut,
}
const ubb = t.bb - t.ibb
const denom = t.ab + ubb + t.hbp + t.sf
const lgwOBARaw = (c.wBB * ubb + c.wHBP * t.hbp + c.w1B * t.h1 + c.w2B * t.h2 + c.w3B * t.h3 + c.wHR * t.hr) / denom
// FanGraphs ancla el wOBA de liga al OBP sin intencionales (.313 en 2025, .316 en 2026).
const lgOBP = (t.h1 + t.h2 + t.h3 + t.hr + ubb + t.hbp) / denom
const scale = lgOBP / lgwOBARaw
const r3 = (x: number) => Math.round(x * 1000) / 1000

// ── Pitching constants ────────────────────────────────────────────────────────
// cFIP makes league FIP equal league ERA. Earned runs aren't in the
// play-by-play, so the league totals come from MLB (same as the Python script).
const mlbTotals = await fetch(
  `https://statsapi.mlb.com/api/v1/teams/stats?group=pitching&season=${season}&sportIds=1&gameType=R&stats=season`,
).then(r => r.json()) as { stats: Array<{ splits: Array<{ stat: Record<string, number | string> }> }> }
const lg = { er: 0, outs: 0, hr: 0, bb: 0, hbp: 0, so: 0 }
for (const s of mlbTotals.stats[0].splits) {
  const ip = String(s.stat.inningsPitched)
  const [whole, thirds] = ip.split('.').map(Number)
  lg.outs += whole * 3 + (thirds || 0)
  lg.er += Number(s.stat.earnedRuns)
  lg.hr += Number(s.stat.homeRuns)
  lg.bb += Number(s.stat.baseOnBalls)
  lg.hbp += Number(s.stat.hitByPitch)
  lg.so += Number(s.stat.strikeOuts)
}
const lgIP = lg.outs / 3
const lgERA = (9 * lg.er) / lgIP
const cFIP = lgERA - (13 * lg.hr + 3 * (lg.bb + lg.hbp) - 2 * lg.so) / lgIP

// League HR per fly ball for xFIP. Fly balls = batted-ball trajectory fly_ball
// or popup, the same definition pitchers' xFIP uses (server/stats/pitching.ts).
const [fb] = await sql<{ hr: number; fb: number }[]>`
  SELECT count(*) FILTER (WHERE p.event = 'Home Run')::int AS hr,
         count(*) FILTER (WHERE p.trajectory IN ('fly_ball', 'popup'))::int AS fb
  FROM plays p JOIN games g USING (game_pk)
  WHERE g.season = ${season} AND g.game_type = 'R' AND p.is_pa
`
const lgHRFB = fb.hr / fb.fb

const constants = {
  wBB: r3(c.wBB * scale), wHBP: r3(c.wHBP * scale), w1B: r3(c.w1B * scale),
  w2B: r3(c.w2B * scale), w3B: r3(c.w3B * scale), wHR: r3(c.wHR * scale),
  lgwOBA: r3(lgOBP), wOBAScale: r3(scale), lgRPA: r3(t.runs / t.pa),
  cFIP: r3(cFIP), lgFIP: r3(lgERA), lgHRFB: Math.round(lgHRFB * 10000) / 10000,
  games: t.games, pa: t.pa,
}
console.log(`Constantes RE24 ${season}:`, constants)

if (values.save) {
  await sql`
    INSERT INTO league_constants (season, source, constants)
    VALUES (${season}, 're24', ${sql.json(constants)})
    ON CONFLICT (season, source) DO UPDATE SET constants = EXCLUDED.constants, computed_at = now()
  `
  console.log('Guardadas en league_constants (source = re24).')
}
await sql.end()

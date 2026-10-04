// Calibra la metodología RE24 contra las constantes publicadas por FanGraphs.
// Prueba combinaciones de (a) qué entradas entran a la matriz RE24 y a los
// valores por evento, y (b) qué outs definen el valor del out, y las ordena
// por error contra FanGraphs en todas las temporadas indicadas.
// Uso: npm run db:calibrate
import { sql } from '../../server/db'

type Weights = Record<'wBB' | 'wHBP' | 'w1B' | 'w2B' | 'w3B' | 'wHR' | 'wOBAScale' | 'lgwOBA', number>

// Valores publicados en la página Guts de FanGraphs.
const FANGRAPHS: Record<number, Weights> = {
  2025: { lgwOBA: 0.313, wOBAScale: 1.232, wBB: 0.691, wHBP: 0.722, w1B: 0.882, w2B: 1.252, w3B: 1.584, wHR: 2.037 },
  2026: { lgwOBA: 0.316, wOBAScale: 1.238, wBB: 0.698, wHBP: 0.729, w1B: 0.890, w2B: 1.261, w3B: 1.596, wHR: 2.049 },
}

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference', 'Batter Interference']

const BATTED_OUTS = ['Groundout', 'Flyout', 'Lineout', 'Pop Out', 'Forceout', 'Fielders Choice Out',
  'Bunt Groundout', 'Bunt Pop Out', 'Bunt Lineout']
const DP_OUTS = ['Grounded Into DP', 'Double Play', 'Triple Play', 'Strikeout Double Play']
const SAC_OUTS = ['Sac Fly', 'Sac Bunt', 'Sac Fly Double Play', 'Sac Bunt Double Play']

const OUT_SETS: Record<string, string[]> = {
  'solo rodado':           ['Groundout'],
  'K + batazos':           ['Strikeout', ...BATTED_OUTS],
  'K + batazos + DP':      ['Strikeout', ...BATTED_OUTS, ...DP_OUTS],
  'todos (con sacrificios)': ['Strikeout', ...BATTED_OUTS, ...DP_OUTS, ...SAC_OUTS],
}

// Qué medias entradas usa la matriz RE24 y el cálculo de valores por evento.
// Extra innings: el corredor fantasma no aparece en las bases hasta que se mueve.
// 9.ª+ baja: el home club deja de batear si va ganando y los walk-offs cortan la entrada.
const INNING_FILTERS: Record<string, string> = {
  'todas':              'true',
  'sin extras':         'inning <= 9',
  'entradas 1-8':       'inning <= 8',
  'sin 9.ª+ baja ni extras': "inning <= 8 OR (inning = 9 AND half = 't')",
}

interface EventLw { event: string; n: number; lw: number }

async function runValues(season: number, reFilter: string, rvFilter: string): Promise<EventLw[]> {
  return sql.unsafe<EventLw[]>(`
    WITH sp AS (
      SELECT p.* FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = $1 AND g.game_type = 'R'
    ),
    remaining AS (
      SELECT *, sum(runs_scored) OVER (
        PARTITION BY game_pk, inning, half ORDER BY at_bat_index
        ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS runs_rem
      FROM sp
    ),
    re24 AS (
      SELECT pre_outs, on_1b, on_2b, on_3b, avg(runs_rem) AS re
      FROM remaining WHERE is_pa AND (${reFilter})
      GROUP BY 1, 2, 3, 4
    ),
    pa AS (
      SELECT *, lead(pre_outs) OVER w AS nx_outs, lead(on_1b) OVER w AS nx_1b,
                lead(on_2b) OVER w AS nx_2b, lead(on_3b) OVER w AS nx_3b
      FROM sp WHERE is_pa
      WINDOW w AS (PARTITION BY game_pk, inning, half ORDER BY at_bat_index)
    )
    SELECT pa.event, count(*)::int AS n,
           avg(coalesce(post.re, 0) - coalesce(pre.re, 0) + pa.runs_scored)::float8 AS lw
    FROM pa
    LEFT JOIN re24 pre  ON (pre.pre_outs, pre.on_1b, pre.on_2b, pre.on_3b) = (pa.pre_outs, pa.on_1b, pa.on_2b, pa.on_3b)
    LEFT JOIN re24 post ON (post.pre_outs, post.on_1b, post.on_2b, post.on_3b) = (pa.nx_outs, pa.nx_1b, pa.nx_2b, pa.nx_3b)
    WHERE (${rvFilter.replace(/inning|half/g, m => `pa.${m}`)})
    GROUP BY pa.event
  `, [season])
}

async function counts(season: number) {
  const [t] = await sql<Record<string, number>[]>`
    SELECT
      count(*) FILTER (WHERE NOT (p.event = ANY(${NON_AB})))::int        AS ab,
      count(*) FILTER (WHERE p.event = 'Single')::int                    AS h1,
      count(*) FILTER (WHERE p.event = 'Double')::int                    AS h2,
      count(*) FILTER (WHERE p.event = 'Triple')::int                    AS h3,
      count(*) FILTER (WHERE p.event = 'Home Run')::int                  AS hr,
      count(*) FILTER (WHERE p.event = 'Walk')::int                      AS ubb,
      count(*) FILTER (WHERE p.event = 'Hit By Pitch')::int              AS hbp,
      count(*) FILTER (WHERE p.event IN ('Sac Fly', 'Sac Fly Double Play'))::int AS sf
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${season} AND g.game_type = 'R' AND p.is_pa
  `
  return t
}

function toWeights(lws: EventLw[], outSet: string[], t: Record<string, number>): Weights {
  const lw = Object.fromEntries(lws.map(r => [r.event, r.lw]))
  const outs = lws.filter(r => outSet.includes(r.event))
  const lwOut = outs.reduce((s, r) => s + r.lw * r.n, 0) / outs.reduce((s, r) => s + r.n, 0)
  const c = {
    wBB: lw['Walk'] - lwOut, wHBP: lw['Hit By Pitch'] - lwOut, w1B: lw['Single'] - lwOut,
    w2B: lw['Double'] - lwOut, w3B: lw['Triple'] - lwOut, wHR: lw['Home Run'] - lwOut,
  }
  const denom = t.ab + t.ubb + t.hbp + t.sf
  const raw = (c.wBB * t.ubb + c.wHBP * t.hbp + c.w1B * t.h1 + c.w2B * t.h2 + c.w3B * t.h3 + c.wHR * t.hr) / denom
  // FanGraphs iguala el wOBA de liga al OBP de liga SIN intencionales.
  const lgOBP = (t.h1 + t.h2 + t.h3 + t.hr + t.ubb + t.hbp) / denom
  const scale = lgOBP / raw
  return {
    wBB: c.wBB * scale, wHBP: c.wHBP * scale, w1B: c.w1B * scale, w2B: c.w2B * scale,
    w3B: c.w3B * scale, wHR: c.wHR * scale, wOBAScale: scale, lgwOBA: lgOBP,
  }
}

const KEYS = ['wBB', 'wHBP', 'w1B', 'w2B', 'w3B', 'wHR', 'wOBAScale', 'lgwOBA'] as const
const seasons = Object.keys(FANGRAPHS).map(Number)
const cnt = Object.fromEntries(await Promise.all(seasons.map(async s => [s, await counts(s)] as const)))

const results: Array<{ re: string; rv: string; out: string; err: number; max: number; bySeason: Record<number, Weights> }> = []
for (const [reName, reF] of Object.entries(INNING_FILTERS)) {
  for (const [rvName, rvF] of Object.entries(INNING_FILTERS)) {
    const lwBySeason = Object.fromEntries(await Promise.all(seasons.map(async s => [s, await runValues(s, reF, rvF)] as const)))
    for (const [outName, outSet] of Object.entries(OUT_SETS)) {
      let err = 0, max = 0
      const bySeason: Record<number, Weights> = {}
      for (const s of seasons) {
        const w = toWeights(lwBySeason[s], outSet, cnt[s])
        bySeason[s] = w
        for (const k of KEYS) {
          const d = Math.abs(w[k] - FANGRAPHS[s][k])
          err += d
          max = Math.max(max, d)
        }
      }
      results.push({ re: reName, rv: rvName, out: outName, err: err / (seasons.length * KEYS.length), max, bySeason })
    }
  }
}

results.sort((a, b) => a.err - b.err)
console.log('Mejores combinaciones (error medio absoluto por constante, en milésimas):')
for (const r of results.slice(0, 8)) {
  console.log(`  ${(r.err * 1000).toFixed(1).padStart(5)}  máx ${(r.max * 1000).toFixed(0).padStart(3)}  RE24: ${r.re.padEnd(24)} valores: ${r.rv.padEnd(24)} out: ${r.out}`)
}
const best = results[0]
for (const s of seasons) {
  console.log(`\n${s}  ${'constante'.padEnd(10)} FanGraphs  calculada  diferencia`)
  for (const k of KEYS) {
    const fg = FANGRAPHS[s][k], v = best.bySeason[s][k]
    console.log(`      ${k.padEnd(10)} ${fg.toFixed(3).padStart(9)}  ${v.toFixed(3).padStart(9)}  ${(v - fg >= 0 ? '+' : '') + (v - fg).toFixed(3)}`)
  }
}
await sql.end()

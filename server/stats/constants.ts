// League constants for a season, computed from the plays table:
//   - wOBA weights by RE24 (scripts/compute_linear_weights.py, exact parity
//     verified), with two adjustments calibrated against FanGraphs' published
//     2025 and 2026 constants (scripts/db/calibrate.ts):
//       · league wOBA = league OBP WITHOUT intentional walks (FanGraphs' anchor)
//       · out value = average of balls-in-play outs, not only the groundout
//   - cFIP / lgFIP (league ERA) from MLB team totals, lgHRFB for xFIP.
// Used by the daily cron and by `npm run db:constants`.
import { sql } from '../db.js'

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference', 'Batter Interference']

const BIP_OUTS = ['Groundout', 'Flyout', 'Lineout', 'Pop Out', 'Forceout', 'Fielders Choice Out']

export interface LeagueConstants {
  wBB: number; wHBP: number; w1B: number; w2B: number; w3B: number; wHR: number
  lgwOBA: number; wOBAScale: number; lgRPA: number
  cFIP: number; lgFIP: number; lgHRFB: number
  games: number; pa: number
}

export async function computeConstants(season: number): Promise<LeagueConstants> {
  // Run value of each event: RE(after) − RE(before) + runs scored.
  const runValues = await sql<{ event: string; n: number; lw: number }[]>`
    WITH season_plays AS (
      SELECT p.*
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = ${season} AND g.game_type = 'R'
    ),
    -- Runs from this play to the end of the half-inning (includes non-PA plays).
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
      count(*) FILTER (WHERE p.event = 'Home Run')::int                     AS hr_all,
      count(*) FILTER (WHERE p.trajectory IN ('fly_ball', 'popup'))::int    AS fb,
      count(DISTINCT p.game_pk)::int                                        AS games
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${season} AND g.game_type = 'R' AND p.is_pa
  `
  if (!t.pa) throw new Error(`No regular-season plays for ${season}`)

  const lw = Object.fromEntries(runValues.map(r => [r.event, r.lw]))
  // Out value: frequency-weighted average of the balls-in-play outs. The rule
  // that best reproduces FanGraphs in 2025 and 2026 (−0.248 / −0.251 vs an
  // optimum of −0.244 / −0.246). The Python script used only the groundout.
  const outRows = runValues.filter(r => BIP_OUTS.includes(r.event))
  const lwOut = outRows.reduce((s, r) => s + r.lw * r.n, 0) / outRows.reduce((s, r) => s + r.n, 0)
  const c = {
    wBB: lw['Walk'] - lwOut, wHBP: lw['Hit By Pitch'] - lwOut, w1B: lw['Single'] - lwOut,
    w2B: lw['Double'] - lwOut, w3B: lw['Triple'] - lwOut, wHR: lw['Home Run'] - lwOut,
  }
  const ubb = t.bb - t.ibb
  const denom = t.ab + ubb + t.hbp + t.sf
  const lgwOBARaw = (c.wBB * ubb + c.wHBP * t.hbp + c.w1B * t.h1 + c.w2B * t.h2 + c.w3B * t.h3 + c.wHR * t.hr) / denom
  // FanGraphs anchors league wOBA to OBP without intentional walks (.313 in 2025, .316 in 2026).
  const lgOBP = (t.h1 + t.h2 + t.h3 + t.hr + ubb + t.hbp) / denom
  const scale = lgOBP / lgwOBARaw
  const r3 = (x: number) => Math.round(x * 1000) / 1000

  // cFIP makes league FIP equal league ERA. Earned runs aren't in the
  // play-by-play, so the league totals come from MLB.
  const res = await fetch(
    `https://statsapi.mlb.com/api/v1/teams/stats?group=pitching&season=${season}&sportIds=1&gameType=R&stats=season`,
  )
  if (!res.ok) throw new Error(`MLB team pitching totals: HTTP ${res.status}`)
  const mlbTotals = await res.json() as { stats: Array<{ splits: Array<{ stat: Record<string, number | string> }> }> }
  const lg = { er: 0, outs: 0, hr: 0, bb: 0, hbp: 0, so: 0 }
  for (const s of mlbTotals.stats[0].splits) {
    const [whole, thirds] = String(s.stat.inningsPitched).split('.').map(Number)
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

  // League HR per fly ball for xFIP. Fly balls = trajectory fly_ball or popup,
  // the same definition pitchers' xFIP uses (server/stats/pitching.ts).
  const lgHRFB = t.hr_all / t.fb

  return {
    wBB: r3(c.wBB * scale), wHBP: r3(c.wHBP * scale), w1B: r3(c.w1B * scale),
    w2B: r3(c.w2B * scale), w3B: r3(c.w3B * scale), wHR: r3(c.wHR * scale),
    lgwOBA: r3(lgOBP), wOBAScale: r3(scale), lgRPA: r3(t.runs / t.pa),
    cFIP: r3(cFIP), lgFIP: r3(lgERA), lgHRFB: Math.round(lgHRFB * 10000) / 10000,
    games: t.games, pa: t.pa,
  }
}

export async function saveConstants(season: number, constants: LeagueConstants): Promise<void> {
  await sql`
    INSERT INTO league_constants (season, source, constants)
    VALUES (${season}, 're24', ${sql.json(constants as unknown as Record<string, number>)})
    ON CONFLICT (season, source) DO UPDATE SET constants = EXCLUDED.constants, computed_at = now()
  `
}

// Pitching stats from the plays table: per-pitcher counts by period, role
// (starter / reliever) and batter hand, plus FIP, FIP-, xFIP, WHIP, K-BB% and
// wOBA against, with the constants in league_constants.
import { sql } from '../db.js'
import { getConstants, getParkFactors, woba, type BatterCounts, type WobaConstants } from './batting.js'

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference']

/**
 * Fly balls for xFIP: batted-ball trajectory fly_ball or popup (same definition
 * as lgHRFB in constants.ts). Validated against MLB's xFIP for 2026: 0.066
 * average error; its league HR/FB rate matches MLB's best fit.
 */
const FLY_BALLS = ['fly_ball', 'popup']

export interface PitcherCounts {
  bf: number        // batters faced (completed plate appearances)
  outs: number      // outs recorded, including caught stealing / pickoffs
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
  fb: number
}

export type PitcherRole = 'all' | 'rp'

export interface PitcherFilter {
  season: number
  pitcherIds: number[]
  from?: string
  to?: string
  /** 'rp' = only relief appearances (not the team's starter that game). */
  role?: PitcherRole
}

type Row = PitcherCounts & { pitcher_id: number; team_id: number; bat_side: string | null }

function getPitcherRows(f: PitcherFilter) {
  return sql<Row[]>`
    WITH base AS (
      SELECT p.*,
             -- fielding team: the home team pitches in the top half
             CASE WHEN p.half = 't' THEN g.home_team_id ELSE g.away_team_id END AS team_id
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = ${f.season}
        AND g.game_type = 'R'
        AND p.pitcher_id = ANY(${f.pitcherIds})
        ${f.from ? sql`AND p.game_date >= ${f.from}` : sql``}
        ${f.to ? sql`AND p.game_date <= ${f.to}` : sql``}
    ),
    starters AS (
      -- each side's starter = pitcher of the first play of that half in the game
      SELECT DISTINCT ON (game_pk, half) game_pk, half, pitcher_id AS starter_id
      FROM plays
      WHERE game_pk IN (SELECT DISTINCT game_pk FROM base)
      ORDER BY game_pk, half, at_bat_index
    )
    SELECT b.pitcher_id, b.team_id, b.bat_side,
      count(*) FILTER (WHERE b.is_pa)::int                                                       AS bf,
      coalesce(sum(b.outs_recorded), 0)::int                                                     AS outs,
      count(*) FILTER (WHERE b.is_pa AND NOT (b.event = ANY(${NON_AB})))::int                    AS ab,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Single')::int                                AS h1,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Double')::int                                AS h2,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Triple')::int                                AS h3,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Home Run')::int                              AS hr,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Walk')::int                                  AS ubb,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Intent Walk')::int                           AS ibb,
      count(*) FILTER (WHERE b.is_pa AND b.event = 'Hit By Pitch')::int                          AS hbp,
      count(*) FILTER (WHERE b.is_pa AND b.event IN ('Sac Fly', 'Sac Fly Double Play'))::int    AS sf,
      count(*) FILTER (WHERE b.is_pa AND b.event IN ('Strikeout', 'Strikeout Double Play'))::int AS so,
      count(*) FILTER (WHERE b.is_pa AND b.trajectory = ANY(${FLY_BALLS}))::int                  AS fb
    FROM base b
    JOIN starters s ON s.game_pk = b.game_pk AND s.half = b.half
    ${f.role === 'rp' ? sql`WHERE b.pitcher_id <> s.starter_id` : sql``}
    GROUP BY 1, 2, 3
  `
}

/** OBP / SLG of a set of counts; null without plate appearances / at-bats. */
function obpSlg(c: PitcherCounts): { obp: number | null; slg: number | null } {
  const bb = c.ubb + c.ibb
  const h = c.h1 + c.h2 + c.h3 + c.hr
  const den = c.ab + bb + c.hbp + c.sf
  return {
    obp: den ? (h + bb + c.hbp) / den : null,
    slg: c.ab ? (c.h1 + 2 * c.h2 + 3 * c.h3 + 4 * c.hr) / c.ab : null,
  }
}

type LeagueOps = Record<'all' | 'L' | 'R', { obp: number | null; slg: number | null }>

/**
 * All-MLB OBP / SLG for the same window, overall and by batter hand: the base of
 * OPS+ against (Baseball-Reference's sOPS+: a split is compared with the
 * league in that same split).
 */
async function getLeagueOps(f: PitcherFilter): Promise<LeagueOps> {
  const rows = await sql<Array<PitcherCounts & { bat_side: string | null }>>`
    SELECT p.bat_side,
      count(*) FILTER (WHERE p.is_pa)::int                                                    AS bf,
      0::int                                                                                  AS outs,
      count(*) FILTER (WHERE p.is_pa AND NOT (p.event = ANY(${NON_AB})))::int                 AS ab,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Single')::int                             AS h1,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Double')::int                             AS h2,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Triple')::int                             AS h3,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Home Run')::int                           AS hr,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Walk')::int                               AS ubb,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Intent Walk')::int                        AS ibb,
      count(*) FILTER (WHERE p.is_pa AND p.event = 'Hit By Pitch')::int                       AS hbp,
      count(*) FILTER (WHERE p.is_pa AND p.event IN ('Sac Fly', 'Sac Fly Double Play'))::int AS sf,
      0::int AS so, 0::int AS fb
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${f.season} AND g.game_type = 'R'
      ${f.from ? sql`AND p.game_date >= ${f.from}` : sql``}
      ${f.to ? sql`AND p.game_date <= ${f.to}` : sql``}
    GROUP BY 1
  `
  const all = empty(), L = empty(), R = empty()
  for (const r of rows) {
    for (const t of [all, r.bat_side === 'L' ? L : r.bat_side === 'R' ? R : null]) {
      if (!t) continue
      for (const k of COUNT_KEYS) t[k] += r[k]
    }
  }
  return { all: obpSlg(all), L: obpSlg(L), R: obpSlg(R) }
}

export interface PitchingConstants extends WobaConstants {
  cFIP: number
  lgFIP: number
  lgHRFB: number
}

export interface PitcherSplit {
  bf: number
  ip: number               // decimal innings (outs / 3)
  so: number
  bb: number               // walks including intentional, like MLB's baseOnBalls
  hbp: number
  hr: number
  h: number
  kbbPct: number | null    // (K − BB) / BF × 100
  whip: number | null
  fip: number | null
  fipMinus: number | null  // park-adjusted, 100 = average; FIP+ = 200 − FIP-
  xfip: number | null
  wobaAgainst: number | null
  opsAgainst: number | null
  /** 100 × (OBP/lgOBP + SLG/lgSLG − 1) vs the league in the same split; lower is better. */
  opsPlusAgainst: number | null
}

export interface PitcherLine extends PitcherSplit {
  vsL: PitcherSplit        // vs left-handed batters
  vsR: PitcherSplit
}

const COUNT_KEYS = ['bf', 'outs', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'fb'] as const
const empty = (): PitcherCounts => ({ bf: 0, outs: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0, so: 0, fb: 0 })
const round = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)

function split(c: PitcherCounts, k: PitchingConstants, pf: number, lg: LeagueOps[keyof LeagueOps]): PitcherSplit {
  const ip = c.outs / 3
  const bb = c.ubb + c.ibb
  const h = c.h1 + c.h2 + c.h3 + c.hr
  const fip = ip > 0 ? (13 * c.hr + 3 * (bb + c.hbp) - 2 * c.so) / ip + k.cFIP : null
  const xfip = ip > 0 ? (13 * c.fb * k.lgHRFB + 3 * (bb + c.hbp) - 2 * c.so) / ip + k.cFIP : null
  // FanGraphs FIP-: (FIP + (FIP − FIP × PF)) / lgFIP × 100, with an all-MLB lgFIP (no AL/NL split).
  const fipMinus = fip != null ? ((fip + (fip - fip * pf)) / k.lgFIP) * 100 : null
  const asBatter: BatterCounts = {
    batter_id: 0, pa: c.bf, ab: c.ab, h1: c.h1, h2: c.h2, h3: c.h3, hr: c.hr,
    ubb: c.ubb, ibb: c.ibb, hbp: c.hbp, sf: c.sf, so: c.so, rbi: 0,
  }
  const { obp, slg } = obpSlg(c)
  return {
    bf: c.bf,
    ip: round(ip, 3)!,
    so: c.so, bb, hbp: c.hbp, hr: c.hr, h,
    kbbPct: c.bf ? round(((c.so - bb) / c.bf) * 100, 1) : null,
    whip: ip > 0 ? round((h + bb) / ip, 2) : null,
    fip: round(fip, 2),
    fipMinus: fipMinus == null ? null : Math.round(fipMinus),
    xfip: round(xfip, 2),
    wobaAgainst: c.bf ? round(woba(asBatter, k), 3) : null,
    opsAgainst: obp != null && slg != null ? round(obp + slg, 3) : null,
    opsPlusAgainst: obp != null && slg != null && lg.obp && lg.slg
      ? Math.round(100 * (obp / lg.obp + slg / lg.slg - 1))
      : null,
  }
}

/**
 * FIP, FIP-, xFIP, WHIP, K-BB% and wOBA against (overall, vs LHB, vs RHB) per
 * pitcher. The park factor is weighted by the batters faced with each team,
 * like the batting lines.
 */
export async function getPitcherLines(f: PitcherFilter): Promise<Map<number, PitcherLine>> {
  const [rows, constants, parks, lg] = await Promise.all([
    getPitcherRows(f),
    getConstants(f.season) as Promise<PitchingConstants>,
    getParkFactors(f.season),
    getLeagueOps(f),
  ])
  if (constants.cFIP == null) throw new Error(`No pitching constants for ${f.season} (npm run db:constants -- --save)`)

  type Acc = { c: PitcherCounts; pfBf: number }
  const acc = new Map<number, { all: Acc; L: Acc; R: Acc }>()
  for (const r of rows) {
    let a = acc.get(r.pitcher_id)
    if (!a) acc.set(r.pitcher_id, a = { all: { c: empty(), pfBf: 0 }, L: { c: empty(), pfBf: 0 }, R: { c: empty(), pfBf: 0 } })
    const pf = parks.get(r.team_id) ?? 1
    for (const t of [a.all, r.bat_side === 'L' ? a.L : r.bat_side === 'R' ? a.R : null]) {
      if (!t) continue
      for (const k of COUNT_KEYS) t.c[k] += r[k]
      t.pfBf += pf * r.bf
    }
  }

  const out = new Map<number, PitcherLine>()
  for (const [id, a] of acc) {
    const line = (x: Acc, side: keyof LeagueOps) => split(x.c, constants, x.c.bf ? x.pfBf / x.c.bf : 1, lg[side])
    out.set(id, { ...line(a.all, 'all'), vsL: line(a.L, 'L'), vsR: line(a.R, 'R') })
  }
  return out
}

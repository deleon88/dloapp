// Pitching stats from the plays table: per-pitcher counts by period, role
// (starter / reliever) and batter hand, plus FIP, FIP-, xFIP, WHIP, K-BB% and
// wOBA against, with the constants in league_constants.
import { sql } from '../db.js'
import { constantsSource, type League } from '../leagues.js'
import { getConstants, getParkFactors } from './batting.js'
import {
  obpSlg, pitcherSplit,
  type PitcherCounts, type PitcherSplit, type PitchingConstants,
} from './formulas.js'

export type { PitcherCounts, PitcherSplit, PitchingConstants }

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference']

/**
 * Fly balls for xFIP: batted-ball trajectory fly_ball or popup (same definition
 * as lgHRFB in constants.ts). Validated against MLB's xFIP for 2026: 0.066
 * average error; its league HR/FB rate matches MLB's best fit.
 */
const FLY_BALLS = ['fly_ball', 'popup']

export type PitcherRole = 'all' | 'rp'

export interface PitcherFilter {
  /** MLB by default. */
  league?: League
  season: number
  pitcherIds: number[]
  from?: string
  to?: string
  /** 'rp' = only relief appearances (not the team's starter that game). */
  role?: PitcherRole
}

type Row = PitcherCounts & { pitcher_id: number; team_id: number; bat_side: string | null }

/** Rows of the given pitchers, or (teamIds) of everyone who pitched for those teams. */
function getPitcherRows(f: Omit<PitcherFilter, 'pitcherIds'> & ({ pitcherIds: number[] } | { teamIds: number[] })) {
  const fielding = sql`CASE WHEN p.half = 't' THEN g.home_team_id ELSE g.away_team_id END`
  return sql<Row[]>`
    WITH base AS (
      SELECT p.*,
             -- fielding team: the home team pitches in the top half
             ${fielding} AS team_id
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.league = ${f.league ?? 'MLB'}
        AND g.season = ${f.season}
        AND g.game_type = 'R'
        ${'teamIds' in f ? sql`AND ${fielding} = ANY(${f.teamIds})` : sql`AND p.pitcher_id = ANY(${f.pitcherIds})`}
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

type LeagueOps = Record<'all' | 'L' | 'R', { obp: number | null; slg: number | null }>

/**
 * League-wide OBP / SLG for the same window, overall and by batter hand: the base of
 * OPS+ against (Baseball-Reference's sOPS+: a split is compared with the
 * league in that same split).
 */
async function getLeagueOps(f: Pick<PitcherFilter, 'league' | 'season' | 'from' | 'to'>): Promise<LeagueOps> {
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
    WHERE g.league = ${f.league ?? 'MLB'} AND g.season = ${f.season} AND g.game_type = 'R'
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

export interface PitcherLine extends PitcherSplit {
  vsL: PitcherSplit        // vs left-handed batters
  vsR: PitcherSplit
}

const COUNT_KEYS = ['bf', 'outs', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'fb'] as const
const empty = (): PitcherCounts => ({ bf: 0, outs: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0, so: 0, fb: 0 })

/**
 * FIP, FIP-, xFIP, WHIP, K-BB% and wOBA against (overall, vs LHB, vs RHB) per
 * pitcher. The park factor is weighted by the batters faced with each team,
 * like the batting lines.
 */
export async function getPitcherLines(f: PitcherFilter): Promise<Map<number, PitcherLine>> {
  const [rows, constants, parks, lg] = await Promise.all([
    getPitcherRows(f),
    getConstants(f.season, constantsSource(f.league ?? 'MLB')) as Promise<PitchingConstants>,
    getParkFactors(f.season),
    getLeagueOps(f),
  ])
  if (constants.cFIP == null) throw new Error(`No pitching constants for ${f.season} (npm run db:constants -- --save)`)
  return toLines(rows, r => r.pitcher_id, constants, parks, lg)
}

/** Adds the rows up by `key` (pitcher or team) into lines: overall, vs LHB, vs RHB. */
function toLines(rows: Row[], key: (r: Row) => number, constants: PitchingConstants, parks: Map<number, number>, lg: LeagueOps) {
  type Acc = { c: PitcherCounts; pfBf: number }
  const acc = new Map<number, { all: Acc; L: Acc; R: Acc }>()
  for (const r of rows) {
    let a = acc.get(key(r))
    if (!a) acc.set(key(r), a = { all: { c: empty(), pfBf: 0 }, L: { c: empty(), pfBf: 0 }, R: { c: empty(), pfBf: 0 } })
    const pf = parks.get(r.team_id) ?? 1
    for (const t of [a.all, r.bat_side === 'L' ? a.L : r.bat_side === 'R' ? a.R : null]) {
      if (!t) continue
      for (const k of COUNT_KEYS) t.c[k] += r[k]
      t.pfBf += pf * r.bf
    }
  }

  const out = new Map<number, PitcherLine>()
  for (const [id, a] of acc) {
    const line = (x: Acc, side: keyof LeagueOps) => pitcherSplit(x.c, constants, x.c.bf ? x.pfBf / x.c.bf : 1, lg[side])
    out.set(id, { ...line(a.all, 'all'), vsL: line(a.L, 'L'), vsR: line(a.R, 'R') })
  }
  return out
}

/**
 * Relief line of each team: every relief appearance for it in the window,
 * added up (overall, vs LHB, vs RHB). The schedule's bullpen bar for leagues
 * without depth charts (LIDOM), where "the bullpen" is whoever relieved.
 */
export async function getTeamReliefLines(f: Omit<PitcherFilter, 'pitcherIds' | 'role'> & { teamIds: number[] }): Promise<Map<number, PitcherLine>> {
  const [rows, constants, parks, lg] = await Promise.all([
    getPitcherRows({ ...f, role: 'rp' }),
    getConstants(f.season, constantsSource(f.league ?? 'MLB')) as Promise<PitchingConstants>,
    getParkFactors(f.season),
    getLeagueOps(f),
  ])
  return toLines(rows, r => r.team_id, constants, parks, lg)
}

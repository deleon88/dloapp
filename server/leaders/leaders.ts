// Sortable leaderboards (Stats page): every batter, pitcher or team of a season
// with its full line, from the plays table plus a few MLB bulk numbers (see
// mlb.ts). Filters that change the sample — period, opponent hand, pitcher
// role — are applied here; the rest (minimum PA / IP, team, position, league)
// and the sorting happen on the client over the whole list.
import { sql } from '../db.js'
import { battingTeam, countColumns, getConstants, getParkFactors } from '../stats/batting.js'
import { obpSlg, pitcherSplit, woba, wrcPlus, type PitcherCounts, type PitchingConstants, type WobaConstants } from '../stats/formulas.js'
import {
  getHittingExtras, getPitchingRecords, getPlayerDirectory, getTeamExtras,
  type HittingExtras, type PitchingRecord, type Role,
} from './mlb.js'

export type { Role }
export type Hand = 'L' | 'R'

export interface LeaderFilter {
  season: number
  from?: string
  to?: string
  /** Batters: pitcher's hand. Pitchers: batter's hand. Teams: both, per side. */
  hand?: Hand
  /** Pitchers (and team pitching): only as starter / only in relief. */
  role?: Role
}

const NON_AB = ['Walk', 'Intent Walk', 'Hit By Pitch', 'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play', 'Catcher Interference']

// Batted-ball counts (bunts left out, like the HR/FB of xFIP: fly balls include popups)
function battedBall() {
  return sql`
    count(*) FILTER (WHERE p.trajectory = 'ground_ball')::int                                       AS gb,
    count(*) FILTER (WHERE p.trajectory = 'line_drive')::int                                        AS ld,
    count(*) FILTER (WHERE p.trajectory IN ('fly_ball', 'popup'))::int                              AS fb,
    count(*) FILTER (WHERE p.trajectory IN ('ground_ball', 'line_drive', 'fly_ball', 'popup'))::int AS bip
  `
}

const dates = (f: LeaderFilter) => sql`
  ${f.from ? sql`AND p.game_date >= ${f.from}` : sql``}
  ${f.to ? sql`AND p.game_date <= ${f.to}` : sql``}
`

const round = (x: number | null | undefined, d: number) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d
const pct = (n: number, d: number) => (d ? round((n / d) * 100, 1) : null)

/** Games each team played in the window (base of "qualified": 3.1 PA / 1 IP per team game). */
async function teamGames(f: LeaderFilter): Promise<Record<number, number>> {
  const rows = await sql<{ team_id: number; g: number }[]>`
    SELECT v.team_id, count(*)::int AS g
    FROM games g, LATERAL (VALUES (g.away_team_id), (g.home_team_id)) AS v(team_id)
    WHERE g.season = ${f.season} AND g.game_type = 'R' AND g.pbp_ingested_at IS NOT NULL
      ${f.from ? sql`AND g.game_date >= ${f.from}` : sql``}
      ${f.to ? sql`AND g.game_date <= ${f.to}` : sql``}
    GROUP BY 1
  `
  return Object.fromEntries(rows.map(r => [r.team_id, r.g]))
}

/**
 * Share of the league's plate appearances against that hand (pitcher's hand for
 * batters, batter's for pitchers) in the window: with a hand filter the
 * "qualified" minimum scales by it, or nobody would reach 3.1 PA per team game.
 */
async function handShare(f: LeaderFilter, column: 'pitch_hand' | 'bat_side'): Promise<number> {
  if (!f.hand) return 1
  const [row] = await sql<{ share: number | null }[]>`
    SELECT (count(*) FILTER (WHERE ${sql(column)} = ${f.hand}))::float / nullif(count(*), 0) AS share
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${f.season} AND g.game_type = 'R' AND p.is_pa ${dates(f)}
  `
  return row?.share ?? 1
}

// ── Lines ────────────────────────────────────────────────────────────

interface BatCounts {
  pa: number; ab: number; h1: number; h2: number; h3: number; hr: number
  ubb: number; ibb: number; hbp: number; sf: number; so: number; rbi: number
  gb: number; ld: number; fb: number; bip: number
}
const BAT_KEYS = ['pa', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'rbi', 'gb', 'ld', 'fb', 'bip'] as const
const emptyBat = (): BatCounts => ({ pa: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0, so: 0, rbi: 0, gb: 0, ld: 0, fb: 0, bip: 0 })

export interface BatLine {
  pa: number; ab: number; h: number; d2: number; d3: number; hr: number; rbi: number
  bb: number; so: number; hbp: number
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  iso: number | null; babip: number | null
  kPct: number | null; bbPct: number | null; kbbPct: number | null
  woba: number | null; wrcPlus: number | null
  gbPct: number | null; ldPct: number | null; fbPct: number | null; hrFb: number | null
}

function batLine(c: BatCounts, k: WobaConstants, pf: number): BatLine {
  const h = c.h1 + c.h2 + c.h3 + c.hr
  const bb = c.ubb + c.ibb
  const { obp, slg } = obpSlg(c)
  const avg = c.ab ? h / c.ab : null
  const babipDen = c.ab - c.so - c.hr + c.sf
  const kPct = pct(c.so, c.pa), bbPct = pct(bb, c.pa)
  return {
    pa: c.pa, ab: c.ab, h, d2: c.h2, d3: c.h3, hr: c.hr, rbi: c.rbi, bb, so: c.so, hbp: c.hbp,
    avg: round(avg, 3), obp: round(obp, 3), slg: round(slg, 3),
    ops: obp != null && slg != null ? round(obp + slg, 3) : null,
    iso: avg != null && slg != null ? round(slg - avg, 3) : null,
    babip: babipDen > 0 ? round((h - c.hr) / babipDen, 3) : null,
    kPct, bbPct, kbbPct: kPct != null && bbPct != null ? round(kPct - bbPct, 1) : null,
    woba: round(woba(c, k), 3),
    wrcPlus: round(wrcPlus(c, k, pf), 0),
    gbPct: pct(c.gb, c.bip), ldPct: pct(c.ld, c.bip), fbPct: pct(c.fb, c.bip), hrFb: pct(c.hr, c.fb),
  }
}

type PitCounts = PitcherCounts & { gb: number; ld: number; bip: number }
const PIT_KEYS = ['bf', 'outs', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'fb', 'gb', 'ld', 'bip'] as const
const emptyPit = (): PitCounts => ({ bf: 0, outs: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0, so: 0, fb: 0, gb: 0, ld: 0, bip: 0 })

export interface PitLine {
  bf: number; ip: number; so: number; bb: number; hr: number; h: number
  kPct: number | null; bbPct: number | null; kbbPct: number | null
  whip: number | null; fip: number | null; fipMinus: number | null; xfip: number | null
  hr9: number | null; babip: number | null; wobaAgainst: number | null; avgAgainst: number | null
  gbPct: number | null; ldPct: number | null; fbPct: number | null; hrFb: number | null
}

function pitLine(c: PitCounts, k: PitchingConstants, pf: number): PitLine {
  const s = pitcherSplit(c, k, pf, { obp: null, slg: null })
  const babipDen = c.ab - c.so - c.hr + c.sf
  return {
    bf: s.bf, ip: s.ip, so: s.so, bb: s.bb, hr: s.hr, h: s.h,
    kPct: pct(c.so, c.bf), bbPct: pct(s.bb, c.bf), kbbPct: s.kbbPct,
    whip: s.whip, fip: s.fip, fipMinus: s.fipMinus, xfip: s.xfip,
    hr9: s.ip > 0 ? round((c.hr * 9) / s.ip, 2) : null,
    babip: babipDen > 0 ? round((s.h - c.hr) / babipDen, 3) : null,
    wobaAgainst: s.wobaAgainst,
    avgAgainst: c.ab ? round(s.h / c.ab, 3) : null,
    gbPct: pct(c.gb, c.bip), ldPct: pct(c.ld, c.bip), fbPct: pct(c.fb, c.bip), hrFb: pct(c.hr, c.fb),
  }
}

/** Sums rows of one player (one per team he played for), keeping the latest team. */
function accumulate<C extends object, R extends C & { id: number; team_id: number; g: number; last: string }>(
  rows: R[], keys: readonly (keyof C)[], empty: () => C, weightKey: keyof C, parks: Map<number, number>,
) {
  const acc = new Map<number, { c: C; pfW: number; g: number; team: number; last: string; extra: R[] }>()
  for (const r of rows) {
    let a = acc.get(r.id)
    if (!a) acc.set(r.id, a = { c: empty(), pfW: 0, g: 0, team: r.team_id, last: r.last, extra: [] })
    for (const k of keys) (a.c[k] as number) += r[k as keyof R] as number
    a.pfW += (parks.get(r.team_id) ?? 1) * (r[weightKey as keyof R] as number)
    a.g += r.g
    if (r.last > a.last) { a.last = r.last; a.team = r.team_id }
    a.extra.push(r)
  }
  return acc
}

// ── Batters ──────────────────────────────────────────────────────────

export interface BatterRow extends BatLine, Partial<HittingExtras> {
  id: number; name: string; team: number; pos: string; g: number
}

export async function getBattingLeaders(f: LeaderFilter) {
  type Row = BatCounts & { id: number; team_id: number; g: number; last: string }
  const [rows, k, parks, dir, games, extras, share] = await Promise.all([
    sql<Row[]>`
      SELECT p.batter_id AS id, ${battingTeam()} AS team_id,
             count(DISTINCT p.game_pk)::int AS g, max(p.game_date)::text AS last,
             ${countColumns()}, ${battedBall()}
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = ${f.season} AND g.game_type = 'R' AND p.is_pa ${dates(f)}
        ${f.hand ? sql`AND p.pitch_hand = ${f.hand}` : sql``}
      GROUP BY 1, 2
    `,
    getConstants(f.season),
    getParkFactors(f.season),
    getPlayerDirectory(f.season),
    teamGames(f),
    // Runs / steals have no pitcher-hand split: only without one.
    f.hand ? Promise.resolve(null) : getHittingExtras(f).catch(() => null),
    handShare(f, 'pitch_hand'),
  ])
  const acc = accumulate<BatCounts, Row>(rows, BAT_KEYS, emptyBat, 'pa', parks)
  const players: BatterRow[] = []
  for (const [id, a] of acc) {
    const d = dir.get(id)
    if (d?.pos === 'P') continue   // pitchers batting
    players.push({
      id, name: d?.name ?? String(id), team: a.team, pos: d?.pos ?? '', g: a.g,
      ...batLine(a.c, k, a.c.pa ? a.pfW / a.c.pa : 1),
      ...(extras ? (extras.get(id) ?? { r: 0, sb: 0, cs: 0 }) : {}),
    })
  }
  return { teamGames: games, qualShare: share, players }
}

// ── Pitchers ─────────────────────────────────────────────────────────

export interface PitcherRow extends PitLine, Partial<PitchingRecord> {
  id: number; name: string; team: number; throws: string | null; g: number; gs: number
}

// Each side's starter in each game: the pitcher of the first play of that half.
function startersCte(f: LeaderFilter) {
  return sql`
    st AS (
      SELECT DISTINCT ON (p.game_pk, p.half) p.game_pk, p.half, p.pitcher_id AS starter_id
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = ${f.season} AND g.game_type = 'R' ${dates(f)}
      ORDER BY p.game_pk, p.half, p.at_bat_index
    )
  `
}

function pitchingColumns() {
  return sql`
    count(*) FILTER (WHERE p.is_pa)::int                                                       AS bf,
    coalesce(sum(p.outs_recorded), 0)::int                                                     AS outs,
    count(*) FILTER (WHERE p.is_pa AND NOT (p.event = ANY(${NON_AB})))::int                    AS ab,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Single')::int                                AS h1,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Double')::int                                AS h2,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Triple')::int                                AS h3,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Home Run')::int                              AS hr,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Walk')::int                                  AS ubb,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Intent Walk')::int                           AS ibb,
    count(*) FILTER (WHERE p.is_pa AND p.event = 'Hit By Pitch')::int                          AS hbp,
    count(*) FILTER (WHERE p.is_pa AND p.event IN ('Sac Fly', 'Sac Fly Double Play'))::int    AS sf,
    count(*) FILTER (WHERE p.is_pa AND p.event IN ('Strikeout', 'Strikeout Double Play'))::int AS so,
    ${battedBall()}
  `
}

const fieldingTeam = sql`(CASE WHEN p.half = 't' THEN g.home_team_id ELSE g.away_team_id END)`
const roleWhere = (role?: Role) =>
  role === 'sp' ? sql`AND p.pitcher_id = st.starter_id` : role === 'rp' ? sql`AND p.pitcher_id <> st.starter_id` : sql``

export async function getPitchingLeaders(f: LeaderFilter) {
  type Row = PitCounts & { id: number; team_id: number; g: number; gs: number; last: string }
  const role = f.role ?? 'all'
  const [rows, k, parks, dir, games, records, share] = await Promise.all([
    sql<Row[]>`
      WITH ${startersCte(f)}
      SELECT p.pitcher_id AS id, ${fieldingTeam} AS team_id,
             count(DISTINCT p.game_pk)::int AS g,
             count(DISTINCT p.game_pk) FILTER (WHERE p.pitcher_id = st.starter_id)::int AS gs,
             max(p.game_date)::text AS last,
             ${pitchingColumns()}
      FROM plays p JOIN games g USING (game_pk)
      JOIN st ON st.game_pk = p.game_pk AND st.half = p.half
      WHERE g.season = ${f.season} AND g.game_type = 'R' ${dates(f)} ${roleWhere(role)}
        ${f.hand ? sql`AND p.bat_side = ${f.hand}` : sql``}
      GROUP BY 1, 2
    `,
    getConstants(f.season) as Promise<PitchingConstants>,
    getParkFactors(f.season),
    getPlayerDirectory(f.season),
    teamGames(f),
    // ERA / W-L have no batter-hand split: only without one.
    f.hand ? Promise.resolve(null) : getPitchingRecords({ ...f, role }).catch(() => null),
    handShare(f, 'bat_side'),
  ])
  const acc = accumulate<PitCounts, Row>(rows, PIT_KEYS, emptyPit, 'bf', parks)
  const players: PitcherRow[] = []
  for (const [id, a] of acc) {
    if (!a.c.bf) continue
    const d = dir.get(id)
    players.push({
      id, name: d?.name ?? String(id), team: a.team, throws: d?.throws ?? null,
      g: a.g, gs: a.extra.reduce((n, r) => n + r.gs, 0),
      ...pitLine(a.c, k, a.pfW / a.c.bf),
      ...(records ? (records.get(id) ?? {}) : {}),
    })
  }
  return { teamGames: games, qualShare: share, players, recordsAvailable: records != null }
}

// ── Teams ────────────────────────────────────────────────────────────

export interface TeamRow {
  id: number; g: number; w: number | null; l: number | null
  r: number; sb: number | null; era: number | null
  bat: BatLine; pit: PitLine
}

export async function getTeamLeaders(f: LeaderFilter) {
  type BatRow = BatCounts & { id: number }
  type PitRow = PitCounts & { id: number }
  const role = f.role ?? 'all'
  const [bat, pit, k, parks, games, extras] = await Promise.all([
    sql<BatRow[]>`
      SELECT ${battingTeam()} AS id, ${countColumns()}, ${battedBall()}
      FROM plays p JOIN games g USING (game_pk)
      WHERE g.season = ${f.season} AND g.game_type = 'R' AND p.is_pa ${dates(f)}
        ${f.hand ? sql`AND p.pitch_hand = ${f.hand}` : sql``}
      GROUP BY 1
    `,
    sql<PitRow[]>`
      WITH ${startersCte(f)}
      SELECT ${fieldingTeam} AS id, ${pitchingColumns()}
      FROM plays p JOIN games g USING (game_pk)
      JOIN st ON st.game_pk = p.game_pk AND st.half = p.half
      WHERE g.season = ${f.season} AND g.game_type = 'R' ${dates(f)} ${roleWhere(role)}
        ${f.hand ? sql`AND p.bat_side = ${f.hand}` : sql``}
      GROUP BY 1
    `,
    getConstants(f.season) as Promise<PitchingConstants>,
    getParkFactors(f.season),
    teamGames(f),
    getTeamExtras({ ...f, role }).catch(() => new Map()),
  ])
  // Runs scored count every play (steals of home, wild pitches…), not only PAs
  const runs = await sql<{ id: number; r: number }[]>`
    SELECT ${battingTeam()} AS id, coalesce(sum(p.runs_scored), 0)::int AS r
    FROM plays p JOIN games g USING (game_pk)
    WHERE g.season = ${f.season} AND g.game_type = 'R' ${dates(f)}
      ${f.hand ? sql`AND p.pitch_hand = ${f.hand}` : sql``}
    GROUP BY 1
  `
  const runsBy = new Map(runs.map(r => [r.id, r.r]))
  const pitBy = new Map(pit.map(p => [p.id, p]))
  const teams: TeamRow[] = bat.map(b => {
    const pf = parks.get(b.id) ?? 1
    const x = extras.get(b.id)
    const p = pitBy.get(b.id) ?? { id: b.id, ...emptyPit() }
    return {
      id: b.id, g: games[b.id] ?? 0,
      w: x?.w ?? null, l: x?.l ?? null,
      r: runsBy.get(b.id) ?? 0,
      sb: f.hand ? null : x?.sb ?? null,
      era: f.hand ? null : x?.era ?? null,
      bat: batLine(b, k, pf),
      pit: pitLine(p, k, pf),
    }
  })
  return { teams }
}

// Go-to lineups vs LHP / vs RHP per team, stored in go_to_lineups.
//   - Past lineups come from the lineups table (filled by the ingest);
//     the opposing starter's hand from pitcher_appearances + plays.
//   - Roster (active players, injured list, depth chart) is read live from MLB.
//   - The cron recomputes the teams that just played; the API recomputes any
//     team whose row is older than MAX_AGE (roster moves during the day).
import { sql } from '../db.js'
import { getJson } from '../mlb/pbp.js'
import { getBatterCounts } from '../stats/batting.js'
import { buildGoToLineup, type DepthPlayer, type GoToSlot, type Hand, type PastLineup, type RosterInfo } from './predict.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
export const MAX_AGE_MS = 3 * 60 * 60_000
const HISTORY_GAMES = 60          // enough to find 5 starts vs LHP for any team
const BATTER_POS_CODES = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10'])

export interface GoToPlayer extends GoToSlot {
  fullName: string
  jerseyNumber: string
  avg: string
  obp: string
  pa: number | null
}

export interface HandLineup {
  lineup: GoToPlayer[] | null
  games: number[]
  fallback: boolean
}

export interface TeamGoTo {
  teamId: number
  season: number
  vsRHP: HandLineup
  vsLHP: HandLineup
  computedAt: string
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** The team's lineups this season, newest first, with the opposing starter's hand. */
export async function loadHistory(teamId: number, season: number): Promise<PastLineup[]> {
  const rows = await sql<Array<{ game_pk: number; vs_hand: string | null; spot: number; player_id: number; position: string; innings: number }>>`
    WITH recent AS (
      SELECT DISTINCT l.game_pk, g.game_date, g.game_time
      FROM lineups l JOIN games g USING (game_pk)
      WHERE l.team_id = ${teamId} AND g.season = ${season}
      ORDER BY g.game_date DESC, g.game_time DESC NULLS LAST
      LIMIT ${HISTORY_GAMES}
    ),
    starters AS (
      SELECT r.game_pk, a.pitcher_id
      FROM recent r JOIN pitcher_appearances a ON a.game_pk = r.game_pk AND a.team_id <> ${teamId} AND a.seq = 0
    )
    SELECT l.game_pk, l.spot, l.player_id, l.position, l.innings,
           (SELECT p.pitch_hand FROM plays p
             WHERE p.game_pk = s.game_pk AND p.pitcher_id = s.pitcher_id AND p.pitch_hand IS NOT NULL
             LIMIT 1) AS vs_hand
    FROM recent r
    JOIN lineups l ON l.game_pk = r.game_pk AND l.team_id = ${teamId}
    LEFT JOIN starters s ON s.game_pk = r.game_pk
    ORDER BY r.game_date DESC, r.game_time DESC NULLS LAST, l.game_pk DESC, l.spot
  `
  const games: PastLineup[] = []
  for (const r of rows) {
    let g = games[games.length - 1]
    if (g?.gamePk !== r.game_pk) {
      g = { gamePk: r.game_pk, vsHand: r.vs_hand === 'L' || r.vs_hand === 'R' ? r.vs_hand : null, slots: [] }
      games.push(g)
    }
    g.slots.push({ playerId: r.player_id, position: r.position, innings: r.innings })
  }
  return games
}

interface RosterEntry {
  person: { id: number; fullName: string }
  jerseyNumber?: string
  position?: { code?: string; abbreviation?: string }
  status?: { code?: string }
}

/** Active roster, injured/inactive players and the position players' depth chart. */
export async function loadRoster(teamId: number, season: number): Promise<RosterInfo & { names: Map<number, DepthPlayer> }> {
  const fields = 'roster,person,id,fullName,jerseyNumber,position,code,abbreviation,status'
  const [dc, active] = await Promise.all([
    getJson<{ roster?: RosterEntry[] }>(`${MLB_API}/teams/${teamId}/roster?rosterType=depthChart&season=${season}&fields=${fields}`),
    getJson<{ roster?: RosterEntry[] }>(`${MLB_API}/teams/${teamId}/roster?rosterType=active&season=${season}&fields=${fields}`),
  ])

  const names = new Map<number, DepthPlayer>()
  const remember = (r: RosterEntry) => {
    if (!names.has(r.person.id)) names.set(r.person.id, { id: r.person.id, fullName: r.person.fullName, jerseyNumber: r.jerseyNumber ?? '' })
  }

  const unavailable = new Set<number>()
  const depthByPosition = new Map<string, DepthPlayer[]>()
  for (const r of dc.roster ?? []) {
    remember(r)
    if (r.status?.code !== 'A') { unavailable.add(r.person.id); continue }
    const abbr = r.position?.abbreviation
    if (!abbr || !BATTER_POS_CODES.has(r.position?.code ?? '')) continue
    const list = depthByPosition.get(abbr) ?? []
    list.push(names.get(r.person.id)!)
    depthByPosition.set(abbr, list)
  }

  const activeRoster = active.roster ?? []
  activeRoster.forEach(remember)
  // Off-season the active roster can come back empty: don't rule everyone out.
  const activeSet = activeRoster.length ? new Set(activeRoster.map(r => r.person.id)) : null

  return { active: activeSet, unavailable, depthByPosition, names }
}

// ── Compute + store ─────────────────────────────────────────────────────────

const fmt3 = (x: number | null) => (x == null ? '.---' : x.toFixed(3).replace(/^0/, ''))

/** Recomputes both hands for a team and stores them. */
export async function computeGoTo(teamId: number, season: number): Promise<TeamGoTo> {
  const [history, roster, prevRows] = await Promise.all([
    loadHistory(teamId, season),
    loadRoster(teamId, season),
    sql<Array<{ hand: Hand; lineup: GoToPlayer[] | null }>>`
      SELECT hand, lineup FROM go_to_lineups WHERE team_id = ${teamId} AND season = ${season}`,
  ])
  const prev = new Map(prevRows.map(r => [r.hand, (r.lineup ?? []).map(p => p.id)]))

  const raw = { R: buildGoToLineup(history, 'R', roster, prev.get('R')), L: buildGoToLineup(history, 'L', roster, prev.get('L')) }

  // Names from the roster (or the last lineup's player if no longer listed) and season AVG / OBP / PA.
  const ids = [...new Set([...(raw.R.lineup ?? []), ...(raw.L.lineup ?? [])].map(s => s.id))]
  const missing = ids.filter(id => !roster.names.has(id))
  const [counts, people] = await Promise.all([
    ids.length ? getBatterCounts({ season, batterIds: ids }) : [],
    missing.length
      ? getJson<{ people?: Array<{ id: number; fullName: string; primaryNumber?: string }> }>(
          `${MLB_API}/people?personIds=${missing.join(',')}&fields=people,id,fullName,primaryNumber`)
      : { people: [] },
  ])
  for (const p of people.people ?? []) roster.names.set(p.id, { id: p.id, fullName: p.fullName, jerseyNumber: p.primaryNumber ?? '' })
  const stats = new Map(counts.map(c => {
    const hits = c.h1 + c.h2 + c.h3 + c.hr, bb = c.ubb + c.ibb
    const obpDen = c.ab + bb + c.hbp + c.sf
    return [c.batter_id, { avg: c.ab ? hits / c.ab : null, obp: obpDen ? (hits + bb + c.hbp) / obpDen : null, pa: c.pa }]
  }))

  const hydrate = (r: (typeof raw)['R']): HandLineup => ({
    games: r.games,
    fallback: r.fallback,
    lineup: r.lineup?.map(s => {
      const who = roster.names.get(s.id), st = stats.get(s.id)
      return {
        ...s,
        fullName: who?.fullName ?? String(s.id),
        jerseyNumber: who?.jerseyNumber ?? '',
        avg: fmt3(st?.avg ?? null),
        obp: fmt3(st?.obp ?? null),
        pa: st?.pa ?? null,
      }
    }) ?? null,
  })
  const vsRHP = hydrate(raw.R), vsLHP = hydrate(raw.L)

  let computedAt = new Date()
  for (const [hand, h] of [['R', vsRHP], ['L', vsLHP]] as const) {
    const [row] = await sql<{ computed_at: Date }[]>`
      INSERT INTO go_to_lineups (team_id, season, hand, lineup, games, fallback)
      VALUES (${teamId}, ${season}, ${hand}, ${h.lineup ? sql.json(h.lineup as never) : null}, ${h.games}, ${h.fallback})
      ON CONFLICT (team_id, season, hand) DO UPDATE SET
        lineup = EXCLUDED.lineup, games = EXCLUDED.games, fallback = EXCLUDED.fallback, computed_at = now()
      RETURNING computed_at
    `
    computedAt = row.computed_at
  }
  return { teamId, season, vsRHP, vsLHP, computedAt: computedAt.toISOString() }
}

/** Runs `fn` over `items` with limited concurrency; failures are collected, not thrown. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<unknown>, deadline?: number) {
  const failed: Array<{ item: T; error: string }> = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      if (deadline && Date.now() > deadline) return
      const item = items[next++]
      try { await fn(item) } catch (e) { failed.push({ item, error: (e as Error).message }) }
    }
  }))
  return { done: next - failed.length, failed }
}

/** Recomputes several teams (cron). */
export async function refreshGoTo(teamIds: number[], season: number, deadline?: number) {
  return pool(teamIds, 5, id => computeGoTo(id, season), deadline)
}

/** The 30 MLB clubs (the teams table also has the All-Star AL/NL teams, 159 and 160). */
export async function mlbTeamIds(): Promise<number[]> {
  const rows = await sql<{ team_key: string }[]>`
    SELECT team_key FROM teams WHERE league = 'MLB' AND team_key NOT IN ('159', '160')`
  return rows.map(r => Number(r.team_key)).filter(Number.isInteger)
}

/** Stored go-to lineups; teams missing or older than MAX_AGE are recomputed first. */
export async function getGoTo(teamIds: number[], season: number): Promise<TeamGoTo[]> {
  type Row = { team_id: number; hand: Hand; lineup: GoToPlayer[] | null; games: number[]; fallback: boolean; computed_at: Date }
  const read = () => sql<Row[]>`
    SELECT team_id, hand, lineup, games, fallback, computed_at
    FROM go_to_lineups WHERE season = ${season} AND team_id = ANY(${teamIds})`

  let rows = await read()
  const fresh = new Set(rows.filter(r => Date.now() - r.computed_at.getTime() < MAX_AGE_MS).map(r => r.team_id))
  const stale = teamIds.filter(id => !fresh.has(id))
  if (stale.length) {
    const res = await pool(stale, 6, id => computeGoTo(id, season))
    for (const f of res.failed) console.error(`[go-to] team ${f.item}: ${f.error}`)
    rows = await read()
  }

  const byTeam = new Map<number, TeamGoTo>()
  for (const r of rows) {
    const t = byTeam.get(r.team_id) ?? {
      teamId: r.team_id, season,
      vsRHP: { lineup: null, games: [], fallback: false },
      vsLHP: { lineup: null, games: [], fallback: false },
      computedAt: r.computed_at.toISOString(),
    }
    t[r.hand === 'L' ? 'vsLHP' : 'vsRHP'] = { lineup: r.lineup, games: r.games, fallback: r.fallback }
    if (r.computed_at.toISOString() < t.computedAt) t.computedAt = r.computed_at.toISOString()
    byTeam.set(r.team_id, t)
  }
  return teamIds.map(id => byTeam.get(id)).filter((t): t is TeamGoTo => t != null)
}

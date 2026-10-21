// Projected starters for the games of a date that have no announced probable:
// each team's starts from pitcher_appearances, its active roster (no injured or
// optioned arms), its starters' FIP, and its games from today up to that date
// in order — an earlier game's starter (announced or projected) is used up
// before the next one. See project.ts for the rules and the backtest
// (npm run db:validate-starters).
import { sql } from '../db.js'
import { getJson } from '../mlb/pbp.js'
import { etDate } from '../ingest.js'
import { loadRoster } from '../lineups/goTo.js'
import { getPitcherLines } from '../stats/pitching.js'
import { asTurn, CYCLE_BACK, projectSeries, STALE_DAYS, type Start } from './project.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const HISTORY_DAYS = 45

export interface BulkArm { id: number; fullName: string; pitchHand: string | null }
/** The projected starter; when it's an opener, the arm expected to pitch most of the game behind them. */
export interface ProjectedStarter { id: number; fullName: string; bulk?: BulkArm }
/** gamePk → the projected starter of each side that has none announced. */
export type GameProjections = Record<number, { away?: ProjectedStarter; home?: ProjectedStarter }>

interface SchedGame {
  gamePk: number
  officialDate: string
  gameType: string
  status?: { detailedState?: string; abstractGameState?: string }
  teams: Record<'away' | 'home', { team: { id: number }; probablePitcher?: { id: number } }>
}

const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export async function projectStarters(date: string): Promise<GameProjections> {
  const today = etDate()
  const from = date < today ? date : today
  const sched = await getJson<{ dates?: Array<{ games?: SchedGame[] }> }>(
    `${MLB_API}/schedule?sportId=1&startDate=${from}&endDate=${date}&hydrate=probablePitcher` +
    '&fields=dates,games,gamePk,officialDate,gameType,status,detailedState,abstractGameState,teams,away,home,team,id,probablePitcher',
  )
  const dead = (g: SchedGame) => /^(Postponed|Cancelled)/.test(g.status?.detailedState ?? '')
  // Games still to be played, a game listed twice (postponed) once
  const seen = new Set<number>()
  const games = (sched.dates ?? []).flatMap(d => d.games ?? [])
    .filter(g => !dead(g) && g.status?.abstractGameState === 'Preview' && !seen.has(g.gamePk) && seen.add(g.gamePk))
    .sort((a, b) => a.officialDate.localeCompare(b.officialDate) || a.gamePk - b.gamePk)

  // Teams with a game on that date missing a probable
  const target = games.filter(g => g.officialDate === date)
  const teams = [...new Set(target.flatMap(g => (['away', 'home'] as const)
    .filter(s => !g.teams[s].probablePitcher).map(s => g.teams[s].team.id)))]
  if (!teams.length) return {}

  const season = Number(date.slice(0, 4))
  // Each start, and for a short one the longest reliever behind it (an opener's bulk)
  const rows = await sql<{ team_id: number; d: string; t: string; pitcher_id: number; pitches: number; bulk_id: number | null; bulk_pitches: number | null }[]>`
    SELECT a.team_id, g.game_date::text AS d, g.game_type AS t, a.pitcher_id, a.pitches,
           b.pitcher_id AS bulk_id, b.pitches AS bulk_pitches
    FROM pitcher_appearances a JOIN games g USING (game_pk)
    LEFT JOIN LATERAL (
      SELECT r.pitcher_id, r.pitches FROM pitcher_appearances r
      WHERE r.game_pk = a.game_pk AND r.team_id = a.team_id AND r.seq > 0
      ORDER BY r.outs DESC, r.pitches DESC LIMIT 1
    ) b ON a.pitches < 35
    WHERE a.team_id = ANY(${teams}) AND a.seq = 0 AND g.game_date >= ${shiftDate(date, -HISTORY_DAYS)}
    ORDER BY g.game_date, g.game_pk
  `
  const ids = [...new Set(rows.flatMap(r => (r.bulk_id ? [r.pitcher_id, r.bulk_id] : [r.pitcher_id])))]
  const [lines, rosters] = await Promise.all([
    ids.length ? getPitcherLines({ season, pitcherIds: ids }).catch(() => new Map()) : Promise.resolve(new Map()),
    Promise.all(teams.map(t => loadRoster(t, season).catch(() => null))),
  ])
  const quality = new Map<number, number>()
  for (const [id, l] of lines) if (l.fip != null && l.ip >= 20) quality.set(id, l.fip)

  const out: GameProjections = {}
  const picked = new Set<number>()
  teams.forEach((teamId, i) => {
    const roster = rosters[i]
    // Not on the active roster, or hurt: can't start
    const unavailable = new Set<number>(roster?.unavailable ?? [])
    if (roster?.active) for (const id of ids) if (!roster.active.has(id)) unavailable.add(id)
    const starts: Start[] = rows.filter(r => r.team_id === teamId).map(r => asTurn({ date: r.d, pitcherId: r.pitcher_id, pitches: r.pitches, post: r.t !== 'R', bulkId: r.bulk_id, bulkPitches: r.bulk_pitches }))
    const teamGames = games.filter(g => g.teams.away.team.id === teamId || g.teams.home.team.id === teamId)
    const series = projectSeries(starts, teamGames.map(g => {
      const side = g.teams.away.team.id === teamId ? 'away' : 'home'
      return { date: g.officialDate, announced: g.teams[side].probablePitcher?.id ?? null }
    }), {
      postseason: teamGames.some(g => g.gameType !== 'R'),
      quality, unavailable, staleDays: STALE_DAYS, cycleBack: CYCLE_BACK,
    })
    teamGames.forEach((g, k) => {
      const p = series[k]
      if (g.officialDate !== date || !p.projected || p.id == null) return
      const side = g.teams.away.team.id === teamId ? 'away' : 'home'
      const name = (id: number) => roster?.names.get(id)?.fullName ?? ''
      // An opener's turn: the opener is the starter, the projected arm pitches the bulk
      ;(out[g.gamePk] ??= {})[side] = p.opener != null
        ? { id: p.opener, fullName: name(p.opener), bulk: { id: p.id, fullName: name(p.id), pitchHand: null } }
        : { id: p.id, fullName: name(p.id) }
      picked.add(p.id)
      if (p.opener != null) picked.add(p.opener)
    })
  })

  // Names the rosters didn't have, and the bulk arms' hands: one call
  if (picked.size) {
    const people = await getJson<{ people?: Array<{ id: number; fullName: string; pitchHand?: { code?: string } }> }>(
      `${MLB_API}/people?personIds=${[...picked].join(',')}&fields=people,id,fullName,pitchHand,code`).catch(() => ({ people: [] }))
    const byId = new Map((people.people ?? []).map(p => [p.id, p]))
    for (const g of Object.values(out)) {
      for (const s of [g.away, g.home]) {
        if (!s) continue
        if (!s.fullName) s.fullName = byId.get(s.id)?.fullName ?? ''
        if (s.bulk) {
          s.bulk.fullName ||= byId.get(s.bulk.id)?.fullName ?? ''
          s.bulk.pitchHand = byId.get(s.bulk.id)?.pitchHand?.code ?? null
        }
      }
    }
  }
  return out
}

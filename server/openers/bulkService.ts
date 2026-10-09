// Probable bulk arm behind an opener, with live data:
//   - the team's appearances this season (pitcher_appearances), with which
//     ones came in long behind an opener;
//   - MLB: active roster (injured / optioned arms out) and the team's next
//     announced starter (a rotation arm on the same cadence isn't the bulk).
// Named only when the prediction is confident (see bulk.ts); null otherwise.
import { sql } from '../db.js'
import { getJson } from '../mlb/pbp.js'
import { OPENER_MAX_OUTS } from './detect.js'
import { predictBulk, type TeamAppearance } from './bulk.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const EPOCH = Date.UTC(2000, 0, 1)
const dayOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - EPOCH) / 86_400_000)
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export interface BulkArm {
  id: number
  fullName: string
  pitchHand: string | null
}

async function teamHistory(teamId: number, date: string): Promise<TeamAppearance[]> {
  const rows = await sql<Array<{ pitcher_id: number; day: number; seq: number; outs: number; pitches: number; bulk: boolean }>>`
    SELECT a.pitcher_id, (g.game_date - DATE '2000-01-01')::int AS day, a.seq, a.outs, a.pitches,
           (a.seq = 1 AND s.outs <= ${OPENER_MAX_OUTS} AND (a.outs >= 9 OR a.pitches >= 45)) AS bulk
    FROM pitcher_appearances a
    JOIN games g USING (game_pk)
    LEFT JOIN pitcher_appearances s ON s.game_pk = a.game_pk AND s.team_id = a.team_id AND s.seq = 0
    WHERE a.team_id = ${teamId} AND g.game_type <> 'S'
      AND g.game_date < ${date} AND g.game_date >= ${addDays(date, -45)}
      AND g.season = (SELECT max(season) FROM games WHERE game_type = 'R' AND game_date <= ${date}::date)
  `
  return rows.map(r => ({ pitcherId: r.pitcher_id, day: r.day, isStart: r.seq === 0, outs: r.outs, pitches: r.pitches, bulk: r.bulk }))
}

/** Active roster and the team's announced starters from `date` on (other than the opener). */
async function liveContext(teamId: number, date: string, season: number) {
  const [roster, schedule] = await Promise.all([
    getJson<{ roster?: Array<{ person: { id: number } }> }>(
      `${MLB_API}/teams/${teamId}/roster?rosterType=active&season=${season}&fields=roster,person,id`),
    getJson<{ dates?: Array<{ games?: Array<{ teams: Record<'away' | 'home', { team: { id: number }; probablePitcher?: { id: number } }> }> }> }>(
      `${MLB_API}/schedule?sportId=1&teamId=${teamId}&startDate=${date}&endDate=${addDays(date, 3)}` +
      '&hydrate=probablePitcher&fields=dates,games,teams,away,home,team,id,probablePitcher'),
  ])
  const active = roster.roster?.length ? new Set(roster.roster.map(r => r.person.id)) : null
  const announced = new Set<number>()
  for (const d of schedule.dates ?? []) for (const g of d.games ?? []) {
    const side = g.teams.away.team.id === teamId ? g.teams.away : g.teams.home
    if (side.probablePitcher?.id) announced.add(side.probablePitcher.id)
  }
  return { active, announced }
}

export async function getBulkArm(teamId: number, date: string, openerId: number): Promise<BulkArm | null> {
  const season = Number(date.slice(0, 4))
  const [history, { active, announced }] = await Promise.all([teamHistory(teamId, date), liveContext(teamId, date, season)])
  // Every announced starter (next games, a doubleheader's other game) is out, and so is the opener.
  const exclude = new Set([openerId, ...announced])
  const pred = predictBulk(history, dayOf(date), exclude, active)
  if (!pred.confident) return null

  const id = pred.candidates[0].pitcherId
  const people = await getJson<{ people?: Array<{ id: number; fullName: string; pitchHand?: { code?: string } }> }>(
    `${MLB_API}/people?personIds=${id}&fields=people,id,fullName,pitchHand,code`)
  const p = people.people?.[0]
  return p ? { id, fullName: p.fullName, pitchHand: p.pitchHand?.code ?? null } : null
}

// Roles (starter / opener) of a set of probable starters, from their recent
// appearances and how often their team has used openers lately.
import { sql } from '../db.js'
import { classifyPitcher, OPENER_MAX_OUTS, TEAM_GAMES, type Appearance, type RoleInfo } from './detect.js'

export interface Probable {
  id: number
  teamId?: number
}

/**
 * Each pitcher's role from their appearances before `beforeDate` (YYYY-MM-DD,
 * exclusive; default: everything stored). Regular season and postseason count
 * alike.
 *   - Pitcher history: current season only. A pitcher's role changes over the
 *     winter (relievers moved into the rotation), and carrying last season's
 *     appearances cost precision in April (backtest: 96% -> 82%).
 *   - Team context: its last TEAM_GAMES games even across seasons — how much a
 *     team uses openers carries over, and it helps early (April recall 79% -> 85%).
 */
export async function getPitcherRoles(probables: Probable[], beforeDate?: string): Promise<Map<number, RoleInfo>> {
  if (!probables.length) return new Map()
  const ids = [...new Set(probables.map(p => p.id))]
  const teamIds = [...new Set(probables.map(p => p.teamId).filter((t): t is number => t != null))]
  const before = beforeDate ? sql`AND g.game_date < ${beforeDate}` : sql``
  // The season in course at that date (in the off-season, the one that just ended).
  const currentSeason = sql`(SELECT max(season) FROM games WHERE game_type = 'R'
    AND game_date <= ${beforeDate ? sql`${beforeDate}::date` : sql`current_date`})`

  const [rows, teams] = await Promise.all([
    sql<Array<{ pitcher_id: number; seq: number; outs: number; pitches: number }>>`
      SELECT pitcher_id, seq, outs, pitches FROM (
        SELECT a.pitcher_id, a.seq, a.outs, a.pitches,
               row_number() OVER (PARTITION BY a.pitcher_id ORDER BY g.game_date DESC, g.game_time DESC NULLS LAST) AS rn
        FROM pitcher_appearances a JOIN games g USING (game_pk)
        WHERE a.pitcher_id = ANY(${ids}) AND g.game_type <> 'S' AND g.season = ${currentSeason} ${before}
      ) x
      WHERE rn <= 40
      ORDER BY pitcher_id, rn
    `,
    // Opener games (starter <= 6 outs, next pitcher 9+) in each team's last TEAM_GAMES games.
    teamIds.length ? sql<Array<{ team_id: number; opener_games: number }>>`
      SELECT team_id, count(*) FILTER (WHERE opener)::int AS opener_games FROM (
        SELECT s.team_id,
               s.outs <= ${OPENER_MAX_OUTS} AND coalesce(n.outs, 0) >= 9 AS opener,
               row_number() OVER (PARTITION BY s.team_id ORDER BY g.game_date DESC, g.game_time DESC NULLS LAST) AS rn
        FROM pitcher_appearances s
        JOIN games g USING (game_pk)
        LEFT JOIN pitcher_appearances n ON n.game_pk = s.game_pk AND n.team_id = s.team_id AND n.seq = 1
        WHERE s.seq = 0 AND s.team_id = ANY(${teamIds}) AND g.game_type <> 'S' ${before}
      ) x
      WHERE rn <= ${TEAM_GAMES}
      GROUP BY team_id
    ` : [],
  ])

  const history = new Map<number, Appearance[]>()
  for (const r of rows) {
    const list = history.get(r.pitcher_id) ?? []
    list.push({ isStart: r.seq === 0, outs: r.outs, pitches: r.pitches })
    history.set(r.pitcher_id, list)
  }
  const teamOpeners = new Map(teams.map(t => [t.team_id, t.opener_games]))
  return new Map(probables.map(p => [p.id, classifyPitcher(history.get(p.id) ?? [], {
    openerGames: p.teamId != null ? teamOpeners.get(p.teamId) ?? 0 : 0,
  })]))
}

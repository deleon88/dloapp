// Roles (starter / opener) of a set of pitchers from their recent appearances.
import { sql } from '../db.js'
import { classifyPitcher, type Appearance, type RoleInfo } from './detect.js'

/**
 * Each pitcher's role from their appearances before `beforeDate` (YYYY-MM-DD,
 * exclusive; default: all stored). Regular season and postseason count alike.
 */
export async function getPitcherRoles(pitcherIds: number[], beforeDate?: string): Promise<Map<number, RoleInfo>> {
  if (!pitcherIds.length) return new Map()
  const rows = await sql<Array<{ pitcher_id: number; seq: number; outs: number }>>`
    SELECT pitcher_id, seq, outs FROM (
      SELECT a.pitcher_id, a.seq, a.outs,
             row_number() OVER (PARTITION BY a.pitcher_id ORDER BY g.game_date DESC, g.game_time DESC NULLS LAST) AS rn
      FROM pitcher_appearances a JOIN games g USING (game_pk)
      WHERE a.pitcher_id = ANY(${pitcherIds}) AND g.game_type <> 'S'
        ${beforeDate ? sql`AND g.game_date < ${beforeDate}` : sql``}
    ) x
    WHERE rn <= 40
    ORDER BY pitcher_id, rn
  `
  const history = new Map<number, Appearance[]>()
  for (const r of rows) {
    const list = history.get(r.pitcher_id) ?? []
    list.push({ isStart: r.seq === 0, outs: r.outs })
    history.set(r.pitcher_id, list)
  }
  return new Map(pitcherIds.map(id => [id, classifyPitcher(history.get(id) ?? [])]))
}

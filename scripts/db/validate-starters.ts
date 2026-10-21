// Backtest of the projected starter (server/starters/project.ts). For every
// team game, project that game and the next ones in a chain (each pick used up
// before the next game) from the starts known before it, and compare with who
// actually started: Top-1 and Top-3 by horizon (G+1 = the next game). The
// postseason ranks arms by that season's regular-season FIP. Baseline: a fixed
// five-man rotation (the starter of five games ago).
//
//   npm run db:validate-starters -- [--season 2026]
import { sql } from '../../server/db.js'
import { getPitcherLines } from '../../server/stats/pitching.js'
import { CYCLE_BACK, rankStarters, rotation, STALE_DAYS, type ProjectOptions, type Start } from '../../server/starters/project.js'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const seasons = arg('season') ? [Number(arg('season'))] : [2025, 2026]
const HORIZONS = [1, 2, 3, 5, 7, 10]
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')

interface Row { team_id: number; d: string; t: string; pitcher_id: number; pitches: number }

for (const season of seasons) {
  const rows: Row[] = [...await sql<Row[]>`
    SELECT a.team_id, g.game_date::text AS d, g.game_type AS t, a.pitcher_id, a.pitches
    FROM pitcher_appearances a JOIN games g USING (game_pk)
    WHERE g.season = ${season} AND a.seq = 0
    ORDER BY a.team_id, g.game_date, g.game_pk`]
  const ids = [...new Set(rows.map(r => r.pitcher_id))]
  const lines = await getPitcherLines({ season, pitcherIds: ids, to: `${season}-09-30` })
  const quality = new Map<number, number>()
  for (const [id, l] of lines) if (l.fip != null && l.ip >= 20) quality.set(id, l.fip)

  const byTeam = new Map<number, Row[]>()
  for (const r of rows) byTeam.set(r.team_id, [...(byTeam.get(r.team_id) ?? []), r])

  // [games, top-1, top-3] per horizon, regular season; next-game only for the postseason
  const reg = new Map(HORIZONS.map(h => [h, { n: 0, top1: 0, top3: 0, fixed: 0 }]))
  const post = { n: 0, top1: 0, top3: 0 }
  let reachable = 0

  for (const list of byTeam.values()) {
    const starts: Start[] = list.map(r => ({ date: r.d, pitcherId: r.pitcher_id, pitches: r.pitches }))
    for (let i = 10; i < list.length; i++) {
      const isPost = list[i].t !== 'R'
      const opts: ProjectOptions = { postseason: isPost, quality, staleDays: STALE_DAYS, cycleBack: CYCLE_BACK }
      if (isPost) {
        const ranked = rankStarters(starts.slice(0, i), list[i].d, opts)
        post.n++
        if (ranked[0] === list[i].pitcher_id) post.top1++
        if (ranked.slice(0, 3).includes(list[i].pitcher_id)) post.top3++
        continue
      }
      if (rotation(starts.slice(0, i)).includes(list[i].pitcher_id)) reachable++
      // chain: project game i, i+1, … using only what was known before game i
      const history = starts.slice(0, i)
      for (let k = 1; k <= Math.max(...HORIZONS) && i + k - 1 < list.length; k++) {
        const g = list[i + k - 1]
        if (g.t !== 'R') break
        const ranked = rankStarters(history, g.d, opts)
        const t = reg.get(k)
        if (t) {
          t.n++
          if (ranked[0] === g.pitcher_id) t.top1++
          if (ranked.slice(0, 3).includes(g.pitcher_id)) t.top3++
          // fixed rotation: the real starter five games earlier (known before game i only up to G+5)
          if (k <= CYCLE_BACK && list[i + k - 1 - CYCLE_BACK]?.pitcher_id === g.pitcher_id) t.fixed++
        }
        if (ranked[0] != null) history.push({ date: g.d, pitcherId: ranked[0], pitches: 90 })
      }
    }
  }

  console.log(`\n${season} regular season (reachable — the real starter was in the rotation: ${pct(reachable, reg.get(1)!.n)})`)
  console.log('  horizon   top-1    top-3    fixed 5-man')
  for (const h of HORIZONS) {
    const t = reg.get(h)!
    console.log(`  G+${String(h).padEnd(6)} ${pct(t.top1, t.n).padEnd(8)} ${pct(t.top3, t.n).padEnd(8)} ${h <= CYCLE_BACK ? pct(t.fixed, t.n) : '—'}`)
  }
  console.log(`${season} postseason, next game: top-1 ${pct(post.top1, post.n)} · top-3 ${pct(post.top3, post.n)} (${post.n} games)`)
}
await sql.end()

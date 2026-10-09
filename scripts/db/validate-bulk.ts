// Backtest of the bulk-arm prediction (server/openers/bulk.ts).
// For every opener game (starter <= 6 outs, next pitcher 9+), predicts the
// bulk arm with only the team's earlier appearances that season and checks it
// against who actually came in. Also reported only for the games where the
// opener rule (detect.ts) flagged the starter beforehand — the real use case.
// The team's starter in its next game is excluded (in production it's the
// announced probable); --no-next measures without that.
// Uso: npm run db:validate-bulk -- [--season 2026] [--gap 1.5] [--no-next]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { classifyPitcher, OPENER_MAX_OUTS, type Appearance } from '../../server/openers/detect'
import { CONFIDENCE_GAP, isLong, predictBulk, type TeamAppearance } from '../../server/openers/bulk'

const { values } = parseArgs({ options: {
  season: { type: 'string', default: String(new Date().getFullYear()) },
  gap: { type: 'string' },
  'no-next': { type: 'boolean', default: false },
} })
const season = Number(values.season)
const gap = values.gap ? Number(values.gap) : CONFIDENCE_GAP

const rows = await sql<Array<{ game_pk: number; team_id: number; pitcher_id: number; seq: number; outs: number; pitches: number; season: number; day: number; game_type: string }>>`
  SELECT a.game_pk, a.team_id, a.pitcher_id, a.seq, a.outs, a.pitches, g.season, g.game_type,
         (g.game_date - DATE '2000-01-01')::int AS day
  FROM pitcher_appearances a JOIN games g USING (game_pk)
  WHERE g.season BETWEEN ${season - 1} AND ${season} AND g.game_type <> 'S'
  ORDER BY g.game_date, g.game_time NULLS LAST, a.game_pk, a.seq
`
await sql.end()

const games = new Map<string, Array<(typeof rows)[number]>>()
for (const r of rows) { const k = `${r.game_pk}-${r.team_id}`; (games.get(k) ?? games.set(k, []).get(k)!).push(r) }
// The team's starter in its following game: in production, the announced probable.
const nextStarter = new Map<string, number>()
{
  const lastKey = new Map<number, string>()
  for (const [k, g] of games) {
    const s = g.find(a => a.seq === 0)
    if (!s) continue
    const prev = lastKey.get(s.team_id)
    if (prev) nextStarter.set(prev, s.pitcher_id)
    lastKey.set(s.team_id, k)
  }
}
const openerGame = (g: Array<(typeof rows)[number]>) => g[0]?.seq === 0 && g[0].outs <= OPENER_MAX_OUTS && (g[1]?.outs ?? 0) >= 9

const teamHistory = new Map<number, TeamAppearance[]>()      // this season, per team
const pitcherHistory = new Map<number, Appearance[]>()       // this season, per pitcher (newest first)
const teamOpeners = new Map<number, boolean[]>()             // across seasons, per team (newest first)

type Tally = { n: number; top1: number; top3: number; confident: number; confidentRight: number; none: number }
const tally = (): Tally => ({ n: 0, top1: 0, top3: 0, confident: 0, confidentRight: 0, none: 0 })
const all = tally(), flagged = tally()

for (const [key, g] of games) {
  g.sort((a, b) => a.seq - b.seq)
  const { team_id: team, day } = g[0]
  if (g[0].season === season && g[0].game_type === 'R' && openerGame(g)) {
    const actual = g[1].pitcher_id
    const exclude = new Set([g[0].pitcher_id])
    const next = nextStarter.get(key)
    if (next != null && !values['no-next']) exclude.add(next)
    const pred = predictBulk(teamHistory.get(team) ?? [], day, exclude, null, gap)
    const opener = classifyPitcher(pitcherHistory.get(g[0].pitcher_id) ?? [], {
      openerGames: (teamOpeners.get(team) ?? []).slice(0, 30).filter(Boolean).length,
    })
    for (const t of opener.role === 'opener' ? [all, flagged] : [all]) {
      t.n++
      if (!pred.candidates.length) t.none++
      if (pred.candidates[0]?.pitcherId === actual) t.top1++
      if (pred.candidates.some(c => c.pitcherId === actual)) t.top3++
      if (pred.confident) { t.confident++; if (pred.candidates[0].pitcherId === actual) t.confidentRight++ }
    }
  }
  // The game becomes history only now (no leakage).
  const isOpener = openerGame(g)
  if (g[0]?.seq === 0) (teamOpeners.get(team) ?? teamOpeners.set(team, []).get(team)!).unshift(isOpener)
  for (const a of g) {
    if (a.season !== season) continue
    ;(teamHistory.get(team) ?? teamHistory.set(team, []).get(team)!).push({
      pitcherId: a.pitcher_id, day: a.day, isStart: a.seq === 0, outs: a.outs, pitches: a.pitches,
      bulk: isOpener && a.seq === 1 && isLong(a),
    })
    ;(pitcherHistory.get(a.pitcher_id) ?? pitcherHistory.set(a.pitcher_id, []).get(a.pitcher_id)!)
      .unshift({ isStart: a.seq === 0, outs: a.outs, pitches: a.pitches })
  }
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const show = (name: string, t: Tally) => console.log(
  `${name}: ${t.n} juegos · 1er lugar ${pct(t.top1, t.n)} · entre los 3 ${pct(t.top3, t.n)} · sin candidatos ${t.none}\n` +
  `  con confianza (ventaja ≥ ${gap}): ${t.confident} juegos (${pct(t.confident, t.n)}) · acierto ${pct(t.confidentRight, t.confident)}`)
console.log(`Temporada regular ${season}`)
show('Todos los juegos con opener', all)
show('Solo los que la regla marcó como opener antes del juego', flagged)

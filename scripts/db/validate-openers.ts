// Measures the opener rule (server/openers/detect.ts) on a season: for every
// start, classifies the starter with only the appearances before that game and
// compares with what happened.
//   - "opener game": the starter got 6 outs or fewer and the next pitcher 9+.
//   - precision: of the starters flagged, how many went 6 outs or fewer.
// Uso: npm run db:validate-openers -- [--season 2026]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { classifyPitcher, OPENER_MAX_OUTS, TEAM_GAMES, type Appearance } from '../../server/openers/detect'

const { values } = parseArgs({ options: { season: { type: 'string', default: String(new Date().getFullYear()) } } })
const season = Number(values.season)

const rows = await sql<Array<{ game_pk: number; team_id: number; pitcher_id: number; seq: number; outs: number; pitches: number; game_type: string }>>`
  SELECT a.game_pk, a.team_id, a.pitcher_id, a.seq, a.outs, a.pitches, g.game_type
  FROM pitcher_appearances a JOIN games g USING (game_pk)
  WHERE g.season = ${season} AND g.game_type <> 'S'
  ORDER BY g.game_date, g.game_time NULLS LAST, a.game_pk, a.seq
`

// Next pitcher's outs per (game, team), to tell opener games from short starts.
const second = new Map<string, number>()
for (const r of rows) if (r.seq === 1) second.set(`${r.game_pk}-${r.team_id}`, r.outs)

const history = new Map<number, Appearance[]>()   // newest first
const teamGames = new Map<number, boolean[]>()     // per team: was it an opener game? newest first
let injured = 0   // opener games whose starter's latest start went long (cut short, not planned)
let starts = 0, flagged = 0, flaggedShort = 0, flaggedUnder3 = 0, openerGames = 0, openerCaught = 0
const misses: string[] = [], falseFlags: string[] = []

for (const r of rows) {
  const past = history.get(r.pitcher_id) ?? []
  if (r.seq === 0 && r.game_type === 'R') {
    starts++
    const tg = teamGames.get(r.team_id) ?? []
    const info = classifyPitcher(past, { openerGames: tg.slice(0, TEAM_GAMES).filter(Boolean).length })
    const isOpenerGame = r.outs <= OPENER_MAX_OUTS && (second.get(`${r.game_pk}-${r.team_id}`) ?? 0) >= 9
    if (isOpenerGame) openerGames++
    const ls = past.find(a => a.isStart)
    if (isOpenerGame && ls && (ls.outs >= 10 || (ls.pitches ?? 0) >= 55)) injured++
    if (info.role === 'opener') {
      flagged++
      if (r.outs <= 9) flaggedUnder3++
      if (r.outs <= OPENER_MAX_OUTS) flaggedShort++
      else falseFlags.push(`${r.game_pk} p${r.pitcher_id} ${r.outs} outs`)
      if (isOpenerGame) openerCaught++
    } else if (isOpenerGame) {
      misses.push(`${r.game_pk} p${r.pitcher_id} (${past.length} apps antes)`)
    }
  }
  if (r.seq === 0) {
    const tg = teamGames.get(r.team_id) ?? []
    tg.unshift(r.outs <= OPENER_MAX_OUTS && (second.get(`${r.game_pk}-${r.team_id}`) ?? 0) >= 9)
    teamGames.set(r.team_id, tg)
  }
  past.unshift({ isStart: r.seq === 0, outs: r.outs, pitches: r.pitches })
  history.set(r.pitcher_id, past)
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
console.log(`Temporada regular ${season}: ${starts} aperturas, ${openerGames} juegos con opener.`)
console.log(`Marcados como opener: ${flagged} · salieron con ≤${OPENER_MAX_OUTS} outs: ${flaggedShort} (precisión ${pct(flaggedShort, flagged)})`)
console.log(`  … con 3 entradas o menos (≤9 outs): ${flaggedUnder3} (${pct(flaggedUnder3, flagged)})`)
console.log(`Juegos con opener detectados: ${openerCaught}/${openerGames} (cobertura ${pct(openerCaught, openerGames)})`)
console.log(`  … sin contar abridores normales que salieron temprano (${injured}): ${openerCaught}/${openerGames - injured} (${pct(openerCaught, openerGames - injured)})`)
console.log(`\nEjemplos marcados que sí lanzaron largo:`, falseFlags.slice(0, 8))
console.log(`Ejemplos de openers no detectados:`, misses.slice(0, 8))
await sql.end()

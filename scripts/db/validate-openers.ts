// Backtest of the opener rule (server/openers/detect.ts) on a season.
//
// Every regular-season start is classified with ONLY what was known before
// that game: the pitcher's earlier appearances and their team's earlier games
// (both are updated after classifying). Then it's compared with a label built
// from information the rule never sees before the game:
//
//   true opener = a start of 3 IP or less (<= 9 outs, <= 60 pitches: an
//   opener isn't left out there for 90 pitches) by an "opener-type"
//   pitcher, judged on their role AROUND that game (other appearances within
//   30 days before or after, future included): mostly a reliever (half or more
//   of them), or most of their starts (60%+, at least 3) of 2 IP or less.
//   A rotation starter who leaves early (injury, rough outing) is a negative,
//   as MLB treats it. (Whole-season role mislabels starters later moved to
//   the bullpen.)
//
// The label is a proxy (MLB doesn't publish an "opener" flag), so it's
// reported next to plain outcome metrics (how many flagged starts were short).
//
// Uso: npm run db:validate-openers -- [--season 2026] [--carry] [--rule ruta/a/detect.ts ...]
//   --carry team|pitcher|both  starts with the previous season as history: the
//            team's opener games, the pitcher's appearances, or both. The API
//            carries the team only (see server/openers/roles.ts):
//            npm run db:validate-openers -- --season 2026 --carry team
//   --rule   (repeatable) compares other versions of the rule on the same games.
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sql } from '../../server/db'
import * as current from '../../server/openers/detect'

type Classify = (history: Array<{ isStart: boolean; outs: number; pitches?: number }>, team?: { openerGames: number }) => { role: string }

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    rule: { type: 'string', multiple: true, default: [] },
    carry: { type: 'string' },   // team | pitcher | both
  },
})
const season = Number(values.season)
const carryTeam = values.carry === 'team' || values.carry === 'both'
const carryPitcher = values.carry === 'pitcher' || values.carry === 'both'

const rows = await sql<Array<{ game_pk: number; team_id: number; pitcher_id: number; seq: number; outs: number; pitches: number; game_type: string; month: number; day: number; season: number }>>`
  SELECT a.game_pk, a.team_id, a.pitcher_id, a.seq, a.outs, a.pitches, g.game_type,
         extract(month FROM g.game_date)::int AS month, (g.game_date - DATE '2000-01-01')::int AS day, g.season
  FROM pitcher_appearances a JOIN games g USING (game_pk)
  WHERE g.season BETWEEN ${values.carry ? season - 1 : season} AND ${season} AND g.game_type <> 'S'
  ORDER BY g.game_date, g.game_time NULLS LAST, a.game_pk, a.seq
`
await sql.end()

// ── Label: the pitcher's role within 30 days of the game ──
const byPitcher = new Map<number, Array<(typeof rows)[number]>>()
for (const r of rows) if (r.game_type === 'R') (byPitcher.get(r.pitcher_id) ?? byPitcher.set(r.pitcher_id, []).get(r.pitcher_id)!).push(r)
function usageAround(r: (typeof rows)[number]) {
  const u = { apps: 0, relief: 0, starts: 0, shortStarts: 0 }
  for (const o of byPitcher.get(r.pitcher_id) ?? []) {
    if (o === r || Math.abs(o.day - r.day) > 30) continue
    u.apps++
    if (o.seq === 0) { u.starts++; if (o.outs <= 6) u.shortStarts++ } else u.relief++
  }
  return u
}
const openerType = (r: (typeof rows)[number]) => {
  const u = usageAround(r)
  return u.apps > 0 && (u.relief / u.apps >= 0.5 || (u.starts >= 3 && u.shortStarts / u.starts >= 0.6))
}

const isTrueOpener = (r: (typeof rows)[number]) => r.outs <= 9 && r.pitches <= 60 && openerType(r)

// ── Backtest one version of the rule ──
const second = new Map<string, number>()
for (const r of rows) if (r.seq === 1) second.set(`${r.game_pk}-${r.team_id}`, r.outs)
const openerGame = (r: (typeof rows)[number]) => r.outs <= 6 && (second.get(`${r.game_pk}-${r.team_id}`) ?? 0) >= 9

interface Cell { tp: number; fp: number; fn: number; tn: number; flaggedShort: number; flaggedUnder3: number }
const cell = (): Cell => ({ tp: 0, fp: 0, fn: 0, tn: 0, flaggedShort: 0, flaggedUnder3: 0 })
function get(m: Map<string, Cell>, k: string) { let c = m.get(k); if (!c) m.set(k, c = cell()); return c }

function backtest(classify: Classify) {
  const all = cell()
  const byMonth = new Map<string, Cell>(), byHistory = new Map<string, Cell>()
  const history = new Map<number, Array<{ isStart: boolean; outs: number; pitches?: number }>>()
  const teamGames = new Map<number, boolean[]>()
  const fpExamples: string[] = []

  for (const r of rows) {
    const past = history.get(r.pitcher_id) ?? []
    const tg = teamGames.get(r.team_id) ?? []
    if (r.seq === 0 && r.game_type === 'R' && r.season === season) {
      const flagged = classify(past, { openerGames: tg.slice(0, 30).filter(Boolean).length }).role === 'opener'
      const truth = isTrueOpener(r)
      const month = r.month <= 4 ? 'Mar-Abr' : ['', '', '', '', '', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct'][r.month]
      const hist = past.length === 0 ? '0 apps' : past.length <= 2 ? '1-2 apps' : '3+ apps'
      for (const c of [all, get(byMonth, month), get(byHistory, hist)]) {
        if (flagged && truth) c.tp++
        else if (flagged) c.fp++
        else if (truth) c.fn++
        else c.tn++
        if (flagged && r.outs <= 6) c.flaggedShort++
        if (flagged && r.outs <= 9) c.flaggedUnder3++
      }
      if (flagged && !truth && fpExamples.length < 8) {
        const u = usageAround(r)
        fpExamples.push(`${r.game_pk} p${r.pitcher_id}: ${r.outs} outs · ±30 días: ${u.relief}/${u.apps} relevos, ${u.shortStarts}/${u.starts} aperturas cortas`)
      }
    }
    // Only now does this game become history for the next ones (no leakage).
    const prev = r.season !== season
    if (r.seq === 0 && (!prev || carryTeam)) { tg.unshift(openerGame(r)); teamGames.set(r.team_id, tg) }
    if (!prev || carryPitcher) {
      past.unshift({ isStart: r.seq === 0, outs: r.outs, pitches: r.pitches })
      history.set(r.pitcher_id, past)
    }
  }
  return { all, byMonth, byHistory, fpExamples }
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—').padStart(4)
const line = (c: Cell) => {
  const flagged = c.tp + c.fp
  return `prec ${pct(c.tp, flagged)} · recall ${pct(c.tp, c.tp + c.fn)} · FPR ${(c.fp / Math.max(1, c.fp + c.tn) * 100).toFixed(2)}% · ` +
    `TP ${c.tp} FP ${c.fp} FN ${c.fn} TN ${c.tn} · marcados ≤2 IP ${pct(c.flaggedShort, flagged)}, ≤3 IP ${pct(c.flaggedUnder3, flagged)}`
}

const rules: Array<[string, Classify]> = [['actual', current.classifyPitcher]]
for (const p of values.rule ?? []) {
  const mod = await import(pathToFileURL(resolve(p)).href) as { classifyPitcher: Classify }
  rules.push([p.split(/[\\/]/).pop()!, mod.classifyPitcher])
}

const starts = rows.filter(r => r.seq === 0 && r.game_type === 'R' && r.season === season)
const positives = starts.filter(r => isTrueOpener(r)).length
console.log(`Temporada regular ${season}${values.carry ? ` (con historia de ${season - 1})` : ''}: ${starts.length} aperturas · ${positives} openers reales (etiqueta) · ` +
  `${starts.filter(openerGame).length} salidas ≤2 IP seguidas de 3+ IP`)

for (const [name, classify] of rules) {
  const r = backtest(classify)
  console.log(`\n== ${name}\n  total     ${line(r.all)}`)
  for (const k of ['0 apps', '1-2 apps', '3+ apps']) if (r.byHistory.has(k)) console.log(`  ${k.padEnd(9)} ${line(r.byHistory.get(k)!)}`)
  for (const [k, c] of r.byMonth) console.log(`  ${k.padEnd(9)} ${line(c)}`)
  if (rules.length === 1) console.log('  Falsos positivos (ejemplos):\n   ', r.fpExamples.join('\n    '))
}

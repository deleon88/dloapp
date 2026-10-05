// Valida los conteos de bateo calculados desde plays contra la MLB Stats API
// (temporada, vs LHP, vs RHP) y el wRC+ resultante contra FanGraphs.
// Sale con código 1 si algo pasa de la tolerancia, para usarlo como prueba.
// Uso: npm run db:validate-batting -- [--team 135] [--season 2026]
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { getBatterCounts, getConstants, getParkFactors, woba, wrcPlus, type BatterCounts } from '../../server/stats/batting'

const { values } = parseArgs({
  options: {
    team: { type: 'string', default: '135' },
    season: { type: 'string', default: '2026' },
  },
})
const teamId = Number(values.team)
const season = Number(values.season)

// Tolerancias. Los conteos deben ser idénticos; wOBA en milésimas y wRC+ en
// puntos contra FanGraphs (redondeo y constantes propias dejan un margen chico).
const TOL = { countMismatches: 0, wobaMean: 1.0, wobaMax: 3, wrcMean: 1.5, wrcMax: 5 }
const failures: string[] = []
const MLB = 'https://statsapi.mlb.com/api/v1'
type ApiStat = Record<string, number>

const roster = await (await fetch(`${MLB}/teams/${teamId}/roster?rosterType=fullSeason&season=${season}`)).json() as {
  roster: Array<{ position: { type: string }; person: { id: number; fullName: string } }>
}
const players = roster.roster
  .filter(p => p.position.type !== 'Pitcher')
  .map(p => ({ id: p.person.id, name: p.person.fullName }))
const ids = players.map(p => p.id)

// ── 1. Conteos contra la API de MLB ──────────────────────────────────────────
const api = await (await fetch(`${MLB}/people?personIds=${ids.join(',')}&hydrate=stats(group=[hitting],type=[season,statSplits],sitCodes=[vl,vr],season=${season})`)).json() as {
  people: Array<{
    id: number
    fullName: string
    stats?: Array<{
      type: { displayName: string }
      // A traded player has one row per team (with `team`) plus a total row (without).
      splits?: Array<{ split?: { code: string }; team?: { id: number }; stat: ApiStat }>
    }>
  }>
}

const fromApi = (s: ApiStat) => ({
  pa: s.plateAppearances, ab: s.atBats, h1: s.hits - s.doubles - s.triples - s.homeRuns,
  h2: s.doubles, h3: s.triples, hr: s.homeRuns, ubb: s.baseOnBalls - s.intentionalWalks,
  ibb: s.intentionalWalks, hbp: s.hitByPitch, sf: s.sacFlies, so: s.strikeOuts, rbi: s.rbi,
})
const FIELDS = ['pa', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'rbi'] as const

const byId = (rows: BatterCounts[]) => new Map(rows.map(r => [r.batter_id, r]))
// Player totals (all teams) and lines with this team only.
const [dbAll, dbL, dbR, tmAll, tmL, tmR] = await Promise.all([
  getBatterCounts({ season, batterIds: ids }),
  getBatterCounts({ season, batterIds: ids, vsHand: 'L' }),
  getBatterCounts({ season, batterIds: ids, vsHand: 'R' }),
  getBatterCounts({ season, batterIds: ids, teamId }),
  getBatterCounts({ season, batterIds: ids, teamId, vsHand: 'L' }),
  getBatterCounts({ season, batterIds: ids, teamId, vsHand: 'R' }),
])
const db = {
  total: { season: byId(dbAll), vl: byId(dbL), vr: byId(dbR) },
  team: { season: byId(tmAll), vl: byId(tmL), vr: byId(tmR) },
}

let checked = 0
const mismatches: string[] = []
for (const person of api.people) {
  for (const g of person.stats ?? []) {
    for (const s of g.splits ?? []) {
      const key = g.type.displayName === 'season' ? 'season' : s.split?.code
      if (!(key === 'season' || key === 'vl' || key === 'vr')) continue
      // Total row → player totals; this team's row → our lines with this team;
      // other teams' rows aren't checked (their games are covered by their own run).
      const scope = !s.team ? 'total' : s.team.id === teamId ? 'team' : null
      if (!scope) continue
      const a = fromApi(s.stat)
      const d = db[scope][key].get(person.id)
      checked++
      const diffs = FIELDS.filter(f => (d?.[f] ?? 0) !== (a[f] ?? 0)).map(f => `${f} db=${d?.[f] ?? 0} mlb=${a[f]}`)
      if (diffs.length) mismatches.push(`${person.fullName} [${key}, ${scope}]: ${diffs.join(', ')}`)
    }
  }
}
console.log(`Conteos: ${checked - mismatches.length}/${checked} líneas idénticas a la API de MLB (totales y con este equipo).`)
for (const m of mismatches) console.log('  ≠ ' + m)
if (mismatches.length > TOL.countMismatches)
  failures.push(`${mismatches.length} líneas de conteo distintas a MLB (tolerancia ${TOL.countMismatches})`)

// ── 2. wRC+ (solo turnos con este equipo) contra FanGraphs ──────────────────
const c = await getConstants(season)
const pf = (await getParkFactors(season)).get(teamId) ?? 1
const team = [db.team.season, db.team.vl, db.team.vr]

// Referencias de FanGraphs: [wOBA, wRC+] por bateador, solo con este equipo.
type Ref = [number, number] | null
const fixtureFile = new URL(`./fixtures/fangraphs_${season}.json`, import.meta.url)
const fixtures = JSON.parse(await readFile(fixtureFile, 'utf-8').catch(() => '{}')) as
  Record<string, Record<string, { gen: Ref; vsL: Ref; vsR: Ref }>>
const refs = fixtures[String(teamId)]

function summary(label: string, errs: number[], tolMean: number, tolMax: number) {
  const abs = errs.map(Math.abs)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const meanAbs = mean(abs), max = Math.max(...abs)
  console.log(`  ${label}: ${errs.length} comparaciones · exactas ${abs.filter(x => x === 0).length}` +
    ` · ±1 ${abs.filter(x => x <= 1).length} · error medio ${meanAbs.toFixed(2)} · sesgo ${mean(errs).toFixed(2)} · máx ${max}` +
    ` (tolerancia: medio ≤ ${tolMean}, máx ≤ ${tolMax})`)
  if (meanAbs > tolMean || max > tolMax) failures.push(`${label} fuera de tolerancia`)
}

if (refs) {
  const wrcErr: number[] = []
  const wobaErr: number[] = []
  console.log(`\nConstantes re24 ${season} · PF ${pf} · base MLB (sin denominador por liga)`)
  console.log('  bateador             general (wOBA · wRC+)   vs LHP                 vs RHP          nuestro/FG')
  for (const p of players) {
    const r = refs[p.name]
    if (!r) continue
    const cells = [r.gen, r.vsL, r.vsR].map((ref, i) => {
      const b = team[i].get(p.id)
      if (!b || b.pa < 15 || !ref) return '          —           '
      const w = woba(b, c)!
      const v = Math.round(wrcPlus(b, c, pf)!)
      wobaErr.push(Math.round(w * 1000) - Math.round(ref[0] * 1000))
      wrcErr.push(v - ref[1])
      return `${w.toFixed(3).slice(1)}/${ref[0].toFixed(3).slice(1)} · ${String(v).padStart(3)}/${String(ref[1]).padStart(3)}`
    })
    console.log(`  ${p.name.padEnd(20)} ${cells.join('   ')}`)
  }
  console.log('')
  summary('wOBA (en milésimas)', wobaErr, TOL.wobaMean, TOL.wobaMax)
  summary('wRC+', wrcErr, TOL.wrcMean, TOL.wrcMax)
} else {
  console.log(`\nSin referencias de FanGraphs para el equipo ${teamId} (fixtures/fangraphs_${season}.json): solo se validaron conteos.`)
}
await sql.end()

if (failures.length) {
  console.error(`\nFALLÓ: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('\nOK: todo dentro de tolerancia.')

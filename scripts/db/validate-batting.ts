// Valida los conteos de bateo calculados desde plays contra la MLB Stats API
// (temporada, vs LHP, vs RHP) y el wRC+ resultante contra FanGraphs.
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
    stats?: Array<{ type: { displayName: string }; splits?: Array<{ split?: { code: string }; stat: ApiStat }> }>
  }>
}

const fromApi = (s: ApiStat) => ({
  pa: s.plateAppearances, ab: s.atBats, h1: s.hits - s.doubles - s.triples - s.homeRuns,
  h2: s.doubles, h3: s.triples, hr: s.homeRuns, ubb: s.baseOnBalls - s.intentionalWalks,
  ibb: s.intentionalWalks, hbp: s.hitByPitch, sf: s.sacFlies, so: s.strikeOuts, rbi: s.rbi,
})
const FIELDS = ['pa', 'ab', 'h1', 'h2', 'h3', 'hr', 'ubb', 'ibb', 'hbp', 'sf', 'so', 'rbi'] as const

const [dbAll, dbL, dbR] = await Promise.all([
  getBatterCounts({ season, batterIds: ids }),
  getBatterCounts({ season, batterIds: ids, vsHand: 'L' }),
  getBatterCounts({ season, batterIds: ids, vsHand: 'R' }),
])
const byId = (rows: BatterCounts[]) => new Map(rows.map(r => [r.batter_id, r]))
const db = { season: byId(dbAll), vl: byId(dbL), vr: byId(dbR) }

let checked = 0
const mismatches: string[] = []
for (const person of api.people) {
  for (const g of person.stats ?? []) {
    const splits = g.type.displayName === 'season'
      ? [{ key: 'season' as const, stat: g.splits?.[0]?.stat }]   // splits[0] = total de todos sus equipos
      : (g.splits ?? []).map(s => ({ key: s.split?.code as 'vl' | 'vr', stat: s.stat }))
    for (const { key, stat } of splits) {
      if (!stat || !(key === 'season' || key === 'vl' || key === 'vr')) continue
      const a = fromApi(stat)
      const d = db[key].get(person.id)
      checked++
      const diffs = FIELDS.filter(f => (d?.[f] ?? 0) !== (a[f] ?? 0)).map(f => `${f} db=${d?.[f] ?? 0} mlb=${a[f]}`)
      if (diffs.length) mismatches.push(`${person.fullName} [${key}]: ${diffs.join(', ')}`)
    }
  }
}
console.log(`Conteos: ${checked - mismatches.length}/${checked} líneas idénticas a la API de MLB.`)
for (const m of mismatches) console.log('  ≠ ' + m)

// ── 2. wRC+ (solo turnos con este equipo) contra FanGraphs ──────────────────
const c = await getConstants(season)
const pf = (await getParkFactors(season)).get(teamId) ?? 1
const [tAll, tL, tR] = await Promise.all([
  getBatterCounts({ season, batterIds: ids, teamId }),
  getBatterCounts({ season, batterIds: ids, teamId, vsHand: 'L' }),
  getBatterCounts({ season, batterIds: ids, teamId, vsHand: 'R' }),
])
const team = [byId(tAll), byId(tL), byId(tR)]

// Referencias de FanGraphs: [wOBA, wRC+] por bateador, solo con este equipo.
type Ref = [number, number] | null
const fixtureFile = new URL(`./fixtures/fangraphs_${season}.json`, import.meta.url)
const fixtures = JSON.parse(await readFile(fixtureFile, 'utf-8').catch(() => '{}')) as
  Record<string, Record<string, { gen: Ref; vsL: Ref; vsR: Ref }>>
const refs = fixtures[String(teamId)]

function summary(label: string, errs: number[]) {
  const abs = errs.map(Math.abs)
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)
  console.log(`  ${label}: ${errs.length} comparaciones · exactas ${abs.filter(x => x === 0).length}` +
    ` · ±1 ${abs.filter(x => x <= 1).length} · error medio ${mean(abs)} · sesgo ${mean(errs)} · máx ${Math.max(...abs)}`)
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
  summary('wOBA (en milésimas)', wobaErr)
  summary('wRC+', wrcErr)
}
await sql.end()

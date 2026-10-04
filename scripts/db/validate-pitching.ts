// Validates pitcher lines computed from plays against the MLB Stats API:
// counts (BF, outs, K, BB, HR, HBP) must match exactly; FIP, xFIP, WHIP and
// FIP- are compared against MLB's own sabermetrics.
// Usage: npm run db:validate-pitching -- [--season 2026] [--min-ip 30]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { getPitcherLines } from '../../server/stats/pitching'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: '2026' },
    'min-ip': { type: 'string', default: '30' },
  },
})
const season = Number(values.season)
const minIp = Number(values['min-ip'])
const MLB = 'https://statsapi.mlb.com/api/v1'

type Stat = Record<string, number | string>
const ipToOuts = (ip: string | number) => {
  const [w, t] = String(ip).split('.').map(Number)
  return w * 3 + (t || 0)
}

const leaders = await (await fetch(
  `${MLB}/stats?stats=season&group=pitching&season=${season}&gameType=R&playerPool=ALL&limit=3000`,
)).json() as { stats: Array<{ splits: Array<{ player: { id: number; fullName: string }; stat: Stat; team?: { id: number } }> }> }

// Total line per pitcher (traded pitchers appear once per team plus a total; keep the max-outs row).
const mlb = new Map<number, { name: string; stat: Stat }>()
for (const s of leaders.stats[0].splits) {
  const prev = mlb.get(s.player.id)
  if (!prev || ipToOuts(s.stat.inningsPitched) > ipToOuts(prev.stat.inningsPitched)) {
    mlb.set(s.player.id, { name: s.player.fullName, stat: s.stat })
  }
}
const ids = [...mlb].filter(([, v]) => ipToOuts(v.stat.inningsPitched) / 3 >= minIp).map(([id]) => id)

const saber = new Map<number, Stat>()
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100)
  const r = await (await fetch(
    `${MLB}/people?personIds=${chunk.join(',')}&hydrate=stats(group=[pitching],type=[sabermetrics],season=${season})`,
  )).json() as { people: Array<{ id: number; stats?: Array<{ splits?: Array<{ stat: Stat }> }> }> }
  for (const p of r.people) {
    const st = p.stats?.[0]?.splits?.[0]?.stat
    if (st) saber.set(p.id, st)
  }
}

const ours = await getPitcherLines({ season, pitcherIds: ids })

let exact = 0
const mismatches: string[] = []
const diffs = { fip: [] as number[], xfip: [] as number[], whip: [] as number[], fipMinus: [] as number[] }
for (const id of ids) {
  const m = mlb.get(id)!.stat
  const o = ours.get(id)
  if (!o) { mismatches.push(`${mlb.get(id)!.name}: sin datos en la base`); continue }
  const checks: Array<[string, number, number]> = [
    ['BF', o.bf, Number(m.battersFaced)],
    ['outs', Math.round(o.ip * 3), ipToOuts(m.inningsPitched)],
    ['K', o.so, Number(m.strikeOuts)],
    ['BB', o.bb, Number(m.baseOnBalls)],
    ['HR', o.hr, Number(m.homeRuns)],
    ['HBP', o.hbp, Number(m.hitByPitch)],
  ]
  const bad = checks.filter(([, a, b]) => a !== b)
  if (bad.length) mismatches.push(`${mlb.get(id)!.name}: ${bad.map(([k, a, b]) => `${k} db=${a} mlb=${b}`).join(', ')}`)
  else exact++

  const s = saber.get(id)
  if (s && o.fip != null) diffs.fip.push(o.fip - Number(s.fip))
  if (s && o.xfip != null && s.xfip != null) diffs.xfip.push(o.xfip - Number(s.xfip))
  if (s && o.fipMinus != null && s.fipMinus != null) diffs.fipMinus.push(o.fipMinus - Number(s.fipMinus))
  if (o.whip != null) diffs.whip.push(o.whip - Number(m.whip))
}

console.log(`Pitchers con ≥${minIp} IP en ${season}: ${ids.length}`)
console.log(`Conteos idénticos a MLB (BF, outs, K, BB, HR, HBP): ${exact}/${ids.length}`)
for (const m of mismatches.slice(0, 15)) console.log('  ≠ ' + m)
const fmt = (xs: number[], d: number) => {
  const abs = xs.map(Math.abs)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  return `n=${xs.length} · error medio ${mean(abs).toFixed(d)} · sesgo ${mean(xs).toFixed(d)} · máx ${Math.max(...abs).toFixed(d)}`
}
console.log(`FIP   vs MLB: ${fmt(diffs.fip, 3)}`)
console.log(`xFIP  vs MLB: ${fmt(diffs.xfip, 3)}`)
console.log(`WHIP  vs MLB: ${fmt(diffs.whip, 3)}`)
console.log(`FIP-  vs MLB: ${fmt(diffs.fipMinus, 1)}`)
await sql.end()

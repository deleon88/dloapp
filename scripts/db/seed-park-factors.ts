// Carga los factores de parque de un CSV de db/seeds/ en la tabla park_factors.
// Uso: npm run db:seed-park-factors -- --season 2026 [--source fangraphs]
// El CSV se busca en db/seeds/park_factors_{source}_{season}.csv.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    source: { type: 'string', default: 'fangraphs' },
  },
})
const season = Number(values.season)
const source = values.source!

const COLUMNS = ['team_id', 'basic_5yr', 'three_yr', 'one_yr', 'f_1b', 'f_2b', 'f_3b', 'f_hr',
  'f_so', 'f_bb', 'f_gb', 'f_fb', 'f_ld', 'f_iffb', 'f_fip'] as const

const csv = await readFile(new URL(`../../db/seeds/park_factors_${source}_${season}.csv`, import.meta.url), 'utf-8')
const [header, ...lines] = csv.trim().split(/\r?\n/)
const names = header.split(',')

const rows = lines.map(line => {
  const cells = line.split(',')
  const get = (col: string) => cells[names.indexOf(col)]
  const row: Record<string, number | string> = { season, source }
  for (const col of COLUMNS) {
    const v = Number(get(col))
    if (!Number.isFinite(v)) throw new Error(`Valor inválido en ${col}: "${line}"`)
    row[col] = v
  }
  return row
})
if (rows.length !== 30) throw new Error(`Se esperaban 30 equipos y hay ${rows.length}`)

await sql`
  INSERT INTO park_factors ${sql(rows)}
  ON CONFLICT (season, team_id, source) DO UPDATE SET
    basic_5yr = EXCLUDED.basic_5yr, three_yr = EXCLUDED.three_yr, one_yr = EXCLUDED.one_yr,
    f_1b = EXCLUDED.f_1b, f_2b = EXCLUDED.f_2b, f_3b = EXCLUDED.f_3b, f_hr = EXCLUDED.f_hr,
    f_so = EXCLUDED.f_so, f_bb = EXCLUDED.f_bb, f_gb = EXCLUDED.f_gb, f_fb = EXCLUDED.f_fb,
    f_ld = EXCLUDED.f_ld, f_iffb = EXCLUDED.f_iffb, f_fip = EXCLUDED.f_fip, updated_at = now()
`
console.log(`${rows.length} factores de parque guardados (${source} ${season}).`)
await sql.end()

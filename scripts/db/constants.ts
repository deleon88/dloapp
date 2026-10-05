// League constants (wOBA by RE24, cFIP, lgHRFB) for a season. The calculation
// lives in server/stats/constants.ts; the daily cron recalculates them too.
// Uso: npm run db:constants -- --season 2026 [--save]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { computeConstants, saveConstants } from '../../server/stats/constants'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    save: { type: 'boolean', default: false },
  },
})
const season = Number(values.season)

const constants = await computeConstants(season)
console.log(`Constantes RE24 ${season}:`, constants)

if (values.save) {
  await saveConstants(season, constants)
  console.log('Guardadas en league_constants (source = re24).')
}
await sql.end()

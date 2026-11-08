// League constants (wOBA by RE24, cFIP, lgHRFB) for a season. The calculation
// lives in server/stats/constants.ts; the daily cron recalculates them too.
// Uso: npm run db:constants -- --season 2026 [--league LIDOM] [--save]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { computeConstants, saveConstants } from '../../server/stats/constants'
import { constantsSource, isLeague } from '../../server/leagues'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    league: { type: 'string', default: 'MLB' },
    save: { type: 'boolean', default: false },
  },
})
const season = Number(values.season)
const league = values.league!
if (!isLeague(league)) throw new Error(`Liga desconocida: ${league} (MLB, LIDOM o LMB)`)

const constants = await computeConstants(season, league)
console.log(`Constantes RE24 ${league} ${season}:`, constants)

if (values.save) {
  await saveConstants(season, constants, league)
  console.log(`Guardadas en league_constants (source = ${constantsSource(league)}).`)
}
await sql.end()

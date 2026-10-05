// Llena la tabla lineups para los juegos ya ingresados que no la tienen (los
// anteriores a que la ingesta guardara lineups) y recalcula los go-to.
// Uso: npm run db:backfill-lineups -- [--season 2026] [--concurrency 8]
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { fetchBoxscoreRows } from '../../server/mlb/appearances'
import { mlbTeamIds, refreshGoTo } from '../../server/lineups/goTo'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    concurrency: { type: 'string', default: '8' },
  },
})
const season = Number(values.season)

const games = await sql<{ game_pk: number }[]>`
  SELECT g.game_pk FROM games g
  WHERE g.season = ${season} AND g.pbp_ingested_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM lineups l WHERE l.game_pk = g.game_pk)
  ORDER BY g.game_date DESC
`
console.log(`${games.length} juegos de ${season} sin lineups.`)

let next = 0, done = 0, rows = 0
const failed: Array<{ gamePk: number; error: string }> = []
const t0 = Date.now()
await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
  while (next < games.length) {
    const { game_pk } = games[next++]
    try {
      const { lineups } = await fetchBoxscoreRows(game_pk)
      await sql.begin(async tx => {
        await tx`DELETE FROM lineups WHERE game_pk = ${game_pk}`
        if (lineups.length) await tx`INSERT INTO lineups ${tx(lineups)}`
      })
      rows += lineups.length
    } catch (e) {
      failed.push({ gamePk: game_pk, error: (e as Error).message })
    }
    if (++done % 200 === 0 || done === games.length) {
      console.log(`  ${done}/${games.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    }
  }
}))
console.log(`Lineups: ${rows} filas, ${failed.length} fallidos.`)
for (const f of failed.slice(0, 20)) console.log(`  FALLÓ ${f.gamePk}: ${f.error}`)

console.log('Recalculando lineups go-to de los 30 equipos...')
const res = await refreshGoTo(await mlbTeamIds(), season)
console.log(`  ${res.done} equipos, ${res.failed.length} fallidos.`)
for (const f of res.failed) console.log(`  FALLÓ equipo ${f.item}: ${f.error}`)

await sql.end()
if (failed.length || res.failed.length) process.exitCode = 1

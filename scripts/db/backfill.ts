// Carga inicial: calendario + play-by-play de una temporada completa.
// Uso: npm run db:backfill -- --season 2026 [--concurrency 5]
// Se puede volver a correr: solo procesa los juegos que faltan.
import { parseArgs } from 'node:util'
import { sql } from '../../server/db'
import { ingestMany, pendingGames, syncSchedule } from '../../server/ingest'

const { values } = parseArgs({
  options: {
    season: { type: 'string', default: String(new Date().getFullYear()) },
    concurrency: { type: 'string', default: '5' },
  },
})
const season = Number(values.season)

console.log(`Calendario ${season}...`)
const n = await syncSchedule(`${season}-02-01`, `${season}-11-30`)
console.log(`  ${n} juegos en el calendario.`)

const pending = await pendingGames({ season })
console.log(`  ${pending.length} juegos terminados sin play-by-play.`)

const t0 = Date.now()
const res = await ingestMany(pending, Number(values.concurrency), (done, total) => {
  if (done % 100 === 0 || done === total) {
    console.log(`  ${done}/${total} juegos (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  }
})

console.log(`\nListo: ${res.ok} juegos, ${res.plays.toLocaleString()} jugadas, ${res.failed.length} fallidos.`)
for (const f of res.failed.slice(0, 20)) console.log(`  FALLÓ ${f.gamePk}: ${f.error}`)

const [tot] = await sql<{ games: number; pa: number }[]>`
  SELECT count(DISTINCT p.game_pk)::int AS games, count(*) FILTER (WHERE p.is_pa)::int AS pa
  FROM plays p JOIN games g USING (game_pk)
  WHERE g.season = ${season} AND g.game_type = 'R'
`
console.log(`Temporada regular ${season} en la base: ${tot.games} juegos, ${tot.pa.toLocaleString()} turnos.`)
await sql.end()
if (res.failed.length) process.exitCode = 1

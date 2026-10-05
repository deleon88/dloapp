// Cron diario de Vercel (ver vercel.json → crons).
// 1. Sincroniza el calendario de ayer y hoy (hora del este).
// 2. Ingresa el play-by-play de los juegos terminados que falten.
// 3. Vuelve a ingresar los de los últimos 2 días, por si MLB corrigió la anotación.
// 4. Si entraron juegos de temporada regular, recalcula las constantes de liga.
// 5. Recalcula los lineups go-to (vs LHP / vs RHP) de los equipos con juegos recientes.
// Cada corrida queda en ingest_runs; /api/health avisa si la ingesta se atrasa.
import { timingSafeEqual } from 'node:crypto'
import { sql } from '../../server/db.js'
import { etDate, ingestMany, pendingGames, syncSchedule } from '../../server/ingest.js'
import { computeConstants, saveConstants } from '../../server/stats/constants.js'
import { mlbTeamIds, refreshGoTo } from '../../server/lineups/goTo.js'

export const maxDuration = 300
// Margen para recalcular constantes (~3 s), lineups y cerrar la bitácora antes del límite.
const INGEST_BUDGET_MS = 220_000
const LINEUPS_DEADLINE_MS = 280_000

async function refreshLineups(from: string, to: string, deadline: number): Promise<number> {
  try {
    const teams = await sql<{ team_id: number; season: number }[]>`
      SELECT DISTINCT unnest(ARRAY[away_team_id, home_team_id]) AS team_id, season
      FROM games WHERE game_date BETWEEN ${from} AND ${to} AND game_type <> 'S'`
    const mlb = new Set(await mlbTeamIds())
    const season = Math.max(...teams.map(t => t.season), 0)
    const ids = teams.filter(t => t.season === season && mlb.has(t.team_id)).map(t => t.team_id)
    const res = await refreshGoTo(ids, season, deadline)
    for (const f of res.failed) console.error(`[ingest-games] go-to ${f.item}: ${f.error}`)
    return res.done
  } catch (e) {
    console.error('[ingest-games] lineups', e)
    return 0
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  // Sin secreto configurado no corre nunca: el endpoint quedaría abierto.
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(request.headers.get('authorization') ?? '')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    console.error('[ingest-games] CRON_SECRET no está configurado: corrida rechazada')
    return new Response('CRON_SECRET not configured', { status: 503 })
  }
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 })

  const startedAt = Date.now()
  const [run] = await sql<{ id: number }[]>`INSERT INTO ingest_runs DEFAULT VALUES RETURNING id`

  try {
    const today = etDate()
    const twoDaysAgo = etDate(new Date(Date.now() - 2 * 86_400_000))

    const scheduled = await syncSchedule(twoDaysAgo, today)
    const pending = await pendingGames({ recheckSince: twoDaysAgo })
    const res = await ingestMany(pending, 5, undefined, startedAt + INGEST_BUDGET_MS)

    // Constantes de la temporada regular más reciente que recibió juegos nuevos.
    const failedPks = new Set(res.failed.map(f => f.gamePk))
    const regular = pending.slice(0, pending.length - res.deferred)
      .filter(g => g.game_type === 'R' && !failedPks.has(g.game_pk))
    const constantsSeason = regular.length ? Math.max(...regular.map(g => g.season)) : null
    if (constantsSeason) await saveConstants(constantsSeason, await computeConstants(constantsSeason))

    // Lineups go-to de los equipos que jugaron (nuevos lineups) o juegan hoy.
    // No cuenta como fallo de la corrida: la API los recalcula si están viejos.
    const lineups = await refreshLineups(twoDaysAgo, today, startedAt + LINEUPS_DEADLINE_MS)

    const ok = res.failed.length === 0
    await sql`
      UPDATE ingest_runs SET
        finished_at = now(), ok = ${ok}, scheduled = ${scheduled}, ingested = ${res.ok},
        failed = ${sql.json(res.failed)}, deferred = ${res.deferred}, constants_season = ${constantsSeason},
        lineups_refreshed = ${lineups}
      WHERE id = ${run.id}
    `
    if (!ok) console.error('[ingest-games] fallidos:', res.failed)
    return Response.json({ date: today, scheduled, ...res, constantsSeason, lineups }, { status: ok ? 200 : 500 })
  } catch (e) {
    const message = (e as Error).message
    console.error('[ingest-games]', e)
    await sql`UPDATE ingest_runs SET finished_at = now(), ok = false, error = ${message} WHERE id = ${run.id}`
    return Response.json({ error: message }, { status: 500 })
  }
}

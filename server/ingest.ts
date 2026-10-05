import { sql } from './db.js'
import { fetchGamePlays, fetchSchedule, type ScheduleGame } from './mlb/pbp.js'

/** Inserta o actualiza los juegos del calendario. No toca el estado de ingesta. */
export async function upsertGames(games: ScheduleGame[]): Promise<void> {
  if (!games.length) return
  for (let i = 0; i < games.length; i += 500) {
    const chunk = games.slice(i, i + 500)
    await sql`
      INSERT INTO games ${sql(chunk, 'game_pk', 'season', 'game_date', 'game_type', 'abstract_state',
        'status', 'away_team_id', 'home_team_id', 'venue_id')}
      ON CONFLICT (game_pk) DO UPDATE SET
        season         = EXCLUDED.season,
        game_date      = EXCLUDED.game_date,
        game_type      = EXCLUDED.game_type,
        abstract_state = EXCLUDED.abstract_state,
        status         = EXCLUDED.status,
        away_team_id   = EXCLUDED.away_team_id,
        home_team_id   = EXCLUDED.home_team_id,
        venue_id       = EXCLUDED.venue_id,
        updated_at     = now()
    `
  }
}

export async function syncSchedule(startDate: string, endDate: string): Promise<number> {
  const games = await fetchSchedule(startDate, endDate)
  await upsertGames(games)
  return games.length
}

/** Juegos terminados cuyo play-by-play falta (o hay que revisar desde `recheckSince`). */
export async function pendingGames(opts: { season?: number; recheckSince?: string; limit?: number } = {}) {
  return sql<{ game_pk: number; game_date: string; season: number; game_type: string }[]>`
    SELECT game_pk, to_char(game_date, 'YYYY-MM-DD') AS game_date, season, game_type
    FROM games
    WHERE abstract_state = 'Final'
      AND status NOT IN ('Postponed', 'Cancelled')
      AND status NOT LIKE 'Suspended%'
      ${opts.season ? sql`AND season = ${opts.season}` : sql``}
      AND (pbp_ingested_at IS NULL
           ${opts.recheckSince ? sql`OR game_date >= ${opts.recheckSince}` : sql``})
    ORDER BY game_date, game_pk
    ${opts.limit ? sql`LIMIT ${opts.limit}` : sql``}
  `
}

/** Descarga y guarda el play-by-play de un juego. Idempotente: reemplaza sus filas. */
export async function ingestGame(gamePk: number, gameDate: string): Promise<number> {
  try {
    const rows = await fetchGamePlays(gamePk, gameDate)
    await sql.begin(async tx => {
      await tx`DELETE FROM plays WHERE game_pk = ${gamePk}`
      if (rows.length) await tx`INSERT INTO plays ${tx(rows)}`
      await tx`
        UPDATE games
        SET pbp_ingested_at = now(), pbp_error = NULL,
            pa_count = ${rows.filter(r => r.is_pa).length}, updated_at = now()
        WHERE game_pk = ${gamePk}
      `
    })
    return rows.length
  } catch (e) {
    await sql`UPDATE games SET pbp_error = ${(e as Error).message}, updated_at = now() WHERE game_pk = ${gamePk}`
    throw e
  }
}

export interface IngestResult {
  ok: number
  failed: Array<{ gamePk: number; error: string }>
  plays: number
  /** Juegos que no se empezaron porque se llegó a `deadline`. */
  deferred: number
}

/**
 * Ingresa varios juegos con concurrencia limitada para no saturar la API de MLB.
 * Con `deadline` (epoch ms) no empieza juegos nuevos después de esa hora: los
 * que falten quedan pendientes para la siguiente corrida.
 */
export async function ingestMany(
  games: Array<{ game_pk: number; game_date: string }>,
  concurrency = 5,
  onProgress?: (done: number, total: number) => void,
  deadline?: number,
): Promise<IngestResult> {
  const result: IngestResult = { ok: 0, failed: [], plays: 0, deferred: 0 }
  let next = 0
  let done = 0

  async function worker() {
    while (next < games.length) {
      if (deadline && Date.now() > deadline) break
      const g = games[next++]
      try {
        // Await antes del +=: con `x += await` cada worker sumaría sobre un valor viejo.
        const n = await ingestGame(g.game_pk, g.game_date)
        result.plays += n
        result.ok++
      } catch (e) {
        result.failed.push({ gamePk: g.game_pk, error: (e as Error).message })
      }
      onProgress?.(++done, games.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, worker))
  result.deferred = games.length - next
  return result
}

/** Fecha YYYY-MM-DD en hora del este, que es como MLB define la jornada. */
export function etDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

// GET /api/health — estado de la ingesta, para un monitor externo (UptimeRobot,
// Better Stack…): responde 503 cuando hay que revisar algo y 200 si todo va bien.
// Problemas que detecta:
//   - ninguna corrida exitosa del cron en STALE_HOURS
//   - juegos terminados hace más de un día sin play-by-play
//   - constantes de liga más viejas que el último juego de temporada regular
import { sql } from '../server/db.js'

const STALE_HOURS = 30

export async function GET(): Promise<Response> {
  try {
    const [[lastRun], [lastOk], [backlog], [constants]] = await Promise.all([
      sql`SELECT started_at, finished_at, ok, ingested, deferred, failed, error
          FROM ingest_runs ORDER BY started_at DESC LIMIT 1`,
      sql`SELECT finished_at FROM ingest_runs WHERE ok ORDER BY started_at DESC LIMIT 1`,
      sql`SELECT count(*)::int AS n, min(game_date)::text AS oldest
          FROM games
          WHERE abstract_state = 'Final' AND pbp_ingested_at IS NULL
            AND status NOT IN ('Postponed', 'Cancelled') AND status NOT LIKE 'Suspended%'
            AND game_date < (now() AT TIME ZONE 'America/New_York')::date - 1`,
      sql`SELECT c.season, c.computed_at,
                 (SELECT max(pbp_ingested_at) FROM games g WHERE g.season = c.season AND g.game_type = 'R') AS last_regular
          FROM league_constants c WHERE c.source = 're24' ORDER BY c.season DESC LIMIT 1`,
    ])

    const problems: string[] = []
    const okAge = lastOk?.finished_at ? (Date.now() - new Date(lastOk.finished_at).getTime()) / 3_600_000 : null
    if (okAge == null) problems.push('the ingest cron has never finished successfully')
    else if (okAge > STALE_HOURS) problems.push(`last successful ingest run was ${Math.round(okAge)}h ago`)
    if (backlog.n > 0) problems.push(`${backlog.n} finished games without play-by-play (oldest ${backlog.oldest})`)
    if (constants?.last_regular && new Date(constants.last_regular) > new Date(constants.computed_at))
      problems.push(`league constants for ${constants.season} are older than its latest game`)

    return Response.json(
      {
        ok: problems.length === 0,
        problems,
        lastRun: lastRun ?? null,
        lastSuccessAt: lastOk?.finished_at ?? null,
        constants: constants ? { season: constants.season, computedAt: constants.computed_at } : null,
      },
      { status: problems.length ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error('[api/health]', e)
    return Response.json({ ok: false, problems: ['database unreachable'] }, { status: 503 })
  }
}

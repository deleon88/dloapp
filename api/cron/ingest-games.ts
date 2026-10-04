// Cron diario de Vercel (ver vercel.json → crons).
// 1. Sincroniza el calendario de ayer y hoy (hora del este).
// 2. Ingresa el play-by-play de los juegos terminados que falten.
// 3. Vuelve a ingresar los de los últimos 2 días, por si MLB corrigió la anotación.
import { etDate, ingestMany, pendingGames, syncSchedule } from '../../server/ingest.js'

export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  // Vercel manda este header en las invocaciones de cron cuando CRON_SECRET está definido.
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const today = etDate()
  const twoDaysAgo = etDate(new Date(Date.now() - 2 * 86_400_000))

  await syncSchedule(twoDaysAgo, today)
  const pending = await pendingGames({ recheckSince: twoDaysAgo, limit: 60 })
  const res = await ingestMany(pending, 5)

  if (res.failed.length) console.error('[ingest-games] fallidos:', res.failed)
  return Response.json({ date: today, ...res }, { status: res.failed.length ? 500 : 200 })
}

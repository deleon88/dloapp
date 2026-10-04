// GET /api/stats/batters?ids=1,2,3[&season=2026][&period=season|60days|30days|14days|7days]
//                       [&from=YYYY-MM-DD&to=YYYY-MM-DD]
// wOBA, wRC+, OPS y HR (general, vs LHP, vs RHP) calculados desde el play-by-play.
// `period` calcula el rango en el servidor; `from`/`to` explícitos tienen prioridad.
import { getBatterLines, PERIOD_DAYS, resolvePeriod, type Period } from '../../server/stats/batting.js'

const MAX_IDS = 200
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PERIODS = new Set<string>(['season', ...Object.keys(PERIOD_DAYS)])

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams

  const ids = (q.get('ids') ?? '').split(',').filter(Boolean).map(Number)
  if (!ids.length) return bad('ids es obligatorio')
  if (ids.length > MAX_IDS) return bad(`máximo ${MAX_IDS} ids por petición`)
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) return bad('ids inválidos')

  const season = Number(q.get('season') ?? new Date().getFullYear())
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return bad('season inválida')

  const period = q.get('period') ?? 'season'
  if (!PERIODS.has(period)) return bad(`period debe ser uno de: ${[...PERIODS].join(', ')}`)

  const fromParam = q.get('from') ?? undefined
  const toParam = q.get('to') ?? undefined
  if ((fromParam && !DATE.test(fromParam)) || (toParam && !DATE.test(toParam))) return bad('from/to deben ser YYYY-MM-DD')

  try {
    const range = fromParam || toParam ? { from: fromParam, to: toParam } : await resolvePeriod(season, period as Period)
    const lines = await getBatterLines({ season, batterIds: ids, ...range })
    return Response.json(
      { season, period, from: range.from ?? null, to: range.to ?? null, players: Object.fromEntries(lines) },
      // Los datos solo cambian cuando corre la ingesta diaria: el CDN puede servirlos.
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    )
  } catch (e) {
    console.error('[api/stats/batters]', e)
    return Response.json({ error: 'Error al consultar la base' }, { status: 500 })
  }
}

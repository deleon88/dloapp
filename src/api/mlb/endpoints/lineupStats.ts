import { mlbApi } from '../client'
import { fetchBatterLines, type SplitLine } from '@/api/stats/batters'
import type { StatPeriod } from '@/utils/period'

export interface PlayerStats {
  wRcPlus: number | null
  ops: string | null
  woba: string | null   // formatted as ".348"
  xwoba: string | null  // formatted as ".443" — siempre temporada completa (Savant)
  pa: number | null
  hr: number | null
  rbi: number | null
  sb: number | null     // solo en temporada completa: el play-by-play guardado no trae robos
  /** Líneas vs LHP / vs RHP del mismo periodo, para el filtro de mano (ver applyBatterHand). */
  byHand?: { L: HandStats; R: HandStats }
}

type HandStats = Pick<PlayerStats, 'wRcPlus' | 'ops' | 'woba' | 'pa' | 'hr' | 'rbi'>

/**
 * Cambia cada bateador a su línea vs la mano indicada. `resolve` devuelve la
 * mano para cada id, o null para dejarlo sin datos (p. ej. "vs mano del
 * abridor" sin abridor anunciado). xwOBA y SB no tienen split por mano, así que
 * quedan vacíos en lugar de mostrar el número general con otra etiqueta.
 */
export function applyBatterHand(
  stats: Map<number, PlayerStats>,
  resolve: (id: number) => 'L' | 'R' | null,
): Map<number, PlayerStats> {
  const out = new Map<number, PlayerStats>()
  for (const [id, s] of stats) {
    const hand = resolve(id)
    const split = hand ? s.byHand?.[hand] : undefined
    out.set(id, {
      wRcPlus: null, ops: null, woba: null, pa: null, hr: null, rbi: null,
      ...split,
      xwoba: null,
      sb: null,
    })
  }
  return out
}

interface StatSplit {
  stat: Record<string, unknown>
}

interface StatEntry {
  type: { displayName: string }
  splits: StatSplit[]
}

interface PersonRow {
  id: number
  stats?: StatEntry[]
}

interface PeopleResponse {
  people: PersonRow[]
}

/** Format a numeric rate to baseball convention: ".348" not "0.348" */
function fmtRate(n: number): string {
  return n.toFixed(3).replace(/^0/, '')
}

function handStats(l: SplitLine): HandStats {
  return {
    wRcPlus: l.wrcPlus,
    ops:     l.ops != null ? fmtRate(l.ops) : null,
    woba:    l.woba != null ? fmtRate(l.woba) : null,
    pa:      l.pa,
    hr:      l.hr,
    rbi:     l.rbi,
  }
}

/**
 * Estadísticas de bateo para la tabla de lineups.
 * wRC+, wOBA, OPS, PA, HR y RBI salen de nuestro backend y respetan el periodo
 * elegido. xwOBA viene de MLB y es siempre de temporada completa; SB también
 * viene de MLB y solo se muestra en temporada completa.
 * Si el backend no responde en temporada completa, se usan los de MLB para no
 * dejar la tabla vacía; en un periodo corto se dejan vacíos para no mezclar.
 */
export async function fetchLineupStats(
  playerIds: number[],
  period: StatPeriod = 'season',
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerStats>> {
  if (!playerIds.length) return new Map()

  const [data, ours] = await Promise.all([
    mlbApi.get<PeopleResponse>('/people', {
      personIds: playerIds.join(','),
      season,
      hydrate: `stats(group=[hitting],type=[season,sabermetrics,expectedStatistics],season=${season})`,
    }),
    fetchBatterLines(playerIds, { season, period }).catch(() => null),
  ])
  const mlbFallback = !ours && period === 'season'

  const map = new Map<number, PlayerStats>()

  for (const person of data.people ?? []) {
    const find = (type: string) =>
      person.stats?.find(s => s.type?.displayName === type)?.splits?.[0]?.stat ?? {}

    const s  = find('season')             as { ops?: string; plateAppearances?: number; homeRuns?: number; rbi?: number; stolenBases?: number }
    const sb = find('sabermetrics')       as { wRcPlus?: number; woba?: number }
    const xs = find('expectedStatistics') as { woba?: string }
    const line = ours?.get(person.id)

    map.set(person.id, mlbFallback
      ? {
          wRcPlus: sb.wRcPlus != null ? Math.round(sb.wRcPlus) : null,
          ops:     s.ops ?? null,
          woba:    sb.woba != null ? fmtRate(sb.woba) : null,
          xwoba:   xs.woba ?? null,
          pa:      s.plateAppearances ?? null,
          hr:      s.homeRuns ?? null,
          rbi:     s.rbi ?? null,
          sb:      s.stolenBases ?? null,
        }
      : {
          wRcPlus: line?.wrcPlus ?? null,
          ops:     line?.ops != null ? fmtRate(line.ops) : null,
          woba:    line?.woba != null ? fmtRate(line.woba) : null,
          xwoba:   xs.woba ?? null,
          pa:      line?.pa ?? null,
          hr:      line?.hr ?? null,
          rbi:     line?.rbi ?? null,
          sb:      period === 'season' ? s.stolenBases ?? null : null,
          byHand:  line ? { L: handStats(line.vsL), R: handStats(line.vsR) } : undefined,
        })
  }

  return map
}

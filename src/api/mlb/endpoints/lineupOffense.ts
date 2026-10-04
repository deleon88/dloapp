import { getStartingBattingOrders } from './boxscore'
import { fetchBatterLines, type SplitLine } from '@/api/stats/batters'
import type { StatPeriod } from '@/utils/period'

/** Confirmed batting orders of one game (empty = not confirmed yet). */
export interface GameLineupIds {
  awayIds: number[]
  homeIds: number[]
}

export interface LineupOffense {
  games: Map<number, GameLineupIds>   // keyed by gamePk, so doubleheaders keep their own lineups
  wrc: Map<number, PlayerWrcSplits>   // every batter in those lineups
}

interface GameTeamIds {
  gamePk: number
  awayTeamId: number
  homeTeamId: number
}

// ── Per-player wRC+ + PA (for PA-weighted averages) ───────────────────────────

export interface PlayerWrcPa { wrc: number; pa: number }

/** wRC+ y PA de un bateador: general, vs LHP y vs RHP. */
export interface PlayerWrcSplits {
  all: PlayerWrcPa | null
  L: PlayerWrcPa | null
  R: PlayerWrcPa | null
}

/** 'all' = todos los pitchers; 'L'/'R' = solo vs zurdos / derechos. */
export type WrcSplitKey = keyof PlayerWrcSplits

/** PA-weighted average wRC+ for a list of player IDs, using one split. */
export function weightedWrcAvg(
  ids: number[],
  wrcMap: Map<number, PlayerWrcSplits>,
  split: WrcSplitKey = 'all',
): number | null {
  let sumWrcPa = 0, sumPa = 0
  for (const id of ids) {
    const d = wrcMap.get(id)?.[split]
    if (!d) continue
    sumWrcPa += d.wrc * d.pa
    sumPa    += d.pa
  }
  return sumPa === 0 ? null : Math.round(sumWrcPa / sumPa)
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Confirmed batting orders for each game (from the boxscores) plus every
 * batter's wRC+ splits for the period. The page picks the split to average,
 * so changing the hand filter doesn't refetch anything.
 */
export async function fetchLineupOffenseMap(
  games: GameTeamIds[],
  period: StatPeriod = 'season',
  season = new Date().getFullYear(),
): Promise<LineupOffense> {
  const result: LineupOffense = { games: new Map(), wrc: new Map() }
  if (!games.length) return result

  // 1. Starting batting orders, the same nine the game page shows (not the
  //    current occupants, which change with substitutions during the game)
  const orders = await Promise.all(
    games.map(({ gamePk }) => getStartingBattingOrders(gamePk).catch(() => null)),
  )

  // 2. Collect all unique player IDs across all games
  const allPlayerIds = new Set<number>()
  orders.forEach((o, i) => {
    const awayIds = o?.away ?? []
    const homeIds = o?.home ?? []
    result.games.set(games[i].gamePk, { awayIds, homeIds })
    awayIds.forEach(id => allPlayerIds.add(id))
    homeIds.forEach(id => allPlayerIds.add(id))
  })

  // 3. wRC+ ajustado por parque, desde nuestro backend
  if (allPlayerIds.size) result.wrc = await fetchWrcComputedBulk([...allPlayerIds], period, season)
  return result
}

/**
 * wRC+ y PA por jugador (general, vs LHP, vs RHP) desde /api/stats/batters,
 * para usar con weightedWrcAvg(). El park factor lo pondera el backend según
 * los parques donde bateó cada jugador, no según el estadio del juego de hoy.
 */
export async function fetchWrcComputedBulk(
  playerIds: number[],
  period: StatPeriod = 'season',
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerWrcSplits>> {
  const lines = await fetchBatterLines(playerIds, { season, period })
  const toWrcPa = (l: SplitLine): PlayerWrcPa | null => (l.wrcPlus != null ? { wrc: l.wrcPlus, pa: l.pa } : null)
  const out = new Map<number, PlayerWrcSplits>()
  for (const [id, d] of lines) out.set(id, { all: toWrcPa(d), L: toWrcPa(d.vsL), R: toWrcPa(d.vsR) })
  return out
}

import { mlbApi } from '../client'
import { fetchLineupSabermetrics } from './lineupStats'

interface RawBoxscoreTeam {
  battingOrder: number[]
}
interface RawBoxscoreResponse {
  teams: { away: RawBoxscoreTeam; home: RawBoxscoreTeam }
}

export interface GameOffense {
  awayWrc: number | null
  homeWrc: number | null
  awayCount: number   // # of batters with data — 0 means no confirmed lineup
  homeCount: number
}

interface GameTeamIds {
  gamePk: number
  awayTeamId: number
  homeTeamId: number
}

/**
 * Returns Map<gamePk, GameOffense> so doubleheaders (same teamId, different
 * gamePk) are handled correctly with their own lineups.
 */
export async function fetchLineupOffenseMap(
  games: GameTeamIds[],
  season = new Date().getFullYear(),
): Promise<Map<number, GameOffense>> {
  if (!games.length) return new Map()

  // 1. Fetch all boxscores in parallel, keyed by gamePk
  const boxscores = await Promise.all(
    games.map(({ gamePk }) =>
      mlbApi.get<RawBoxscoreResponse>(`/game/${gamePk}/boxscore`, {
        fields: 'teams,away,home,battingOrder',
      }).catch(() => null),
    ),
  )

  // 2. Collect all unique player IDs across all games
  const gameData: Array<{ gamePk: number; awayIds: number[]; homeIds: number[] }> = []
  const allPlayerIds = new Set<number>()

  boxscores.forEach((bs, i) => {
    const { gamePk } = games[i]
    const awayIds = bs?.teams.away.battingOrder ?? []
    const homeIds = bs?.teams.home.battingOrder ?? []
    gameData.push({ gamePk, awayIds, homeIds })
    awayIds.forEach(id => allPlayerIds.add(id))
    homeIds.forEach(id => allPlayerIds.add(id))
  })

  if (!allPlayerIds.size) return new Map()

  // 3. Bulk sabermetrics — MLB API caps personIds at ~60, chunk if needed
  const ids = [...allPlayerIds]
  const CHUNK = 60
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
    ids.slice(i * CHUNK, (i + 1) * CHUNK)
  )
  const wrcMaps = await Promise.all(chunks.map(chunk => fetchLineupSabermetrics(chunk, season)))
  const wrcMap = new Map<number, number>()
  for (const m of wrcMaps) for (const [k, v] of m) wrcMap.set(k, v)

  // 4. Average per game side, keyed by gamePk
  const result = new Map<number, GameOffense>()
  for (const { gamePk, awayIds, homeIds } of gameData) {
    result.set(gamePk, {
      awayWrc: avg(awayIds, wrcMap),
      homeWrc: avg(homeIds, wrcMap),
      awayCount: awayIds.length,
      homeCount: homeIds.length,
    })
  }
  return result
}

function avg(ids: number[], wrcMap: Map<number, number>): number | null {
  const vals = ids.map(id => wrcMap.get(id)).filter((v): v is number => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

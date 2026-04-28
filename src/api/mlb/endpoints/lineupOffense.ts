import { mlbApi } from '../client'

interface RawBoxscoreTeam {
  battingOrder: number[]
}
interface RawBoxscoreResponse {
  teams: { away: RawBoxscoreTeam; home: RawBoxscoreTeam }
}

export interface GameOffense {
  awayWrc: number | null
  homeWrc: number | null
  awayCount: number   // # of batters in confirmed batting order; 0 = no confirmed lineup
  homeCount: number
}

interface GameTeamIds {
  gamePk: number
  awayTeamId: number
  homeTeamId: number
}

// ── Per-player wRC+ + PA (for PA-weighted averages) ───────────────────────────

export interface PlayerWrcPa { wrc: number; pa: number }

const WRC_PA_FIELDS = [
  'people', 'id',
  'stats', 'type', 'displayName', 'group',
  'splits', 'stat', 'wRcPlus', 'plateAppearances',
].join(',')

async function fetchWrcPaChunk(ids: number[], season: number): Promise<Map<number, PlayerWrcPa>> {
  const data = await mlbApi.get<{
    people: Array<{
      id: number
      stats?: Array<{
        type: { displayName: string }
        group: { displayName: string }
        splits: Array<{ stat: Record<string, unknown> }>
      }>
    }>
  }>('/people', {
    personIds: ids.join(','),
    hydrate: `stats(group=[hitting],type=[season,sabermetrics],season=${season})`,
    fields: WRC_PA_FIELDS,
  })

  const map = new Map<number, PlayerWrcPa>()
  for (const person of data.people ?? []) {
    const find = (t: string) =>
      person.stats?.find(s => s.type.displayName === t && s.group.displayName === 'hitting')
        ?.splits?.[0]?.stat ?? {}
    const sea   = find('season')       as { plateAppearances?: number }
    const saber = find('sabermetrics') as { wRcPlus?: number }
    if (saber.wRcPlus != null) {
      map.set(person.id, { wrc: Math.round(saber.wRcPlus), pa: sea.plateAppearances ?? 1 })
    }
  }
  return map
}

/** Bulk-fetches wRC+ and PA for an arbitrary player list, chunked at 60. */
export async function fetchWrcPaBulk(
  playerIds: number[],
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerWrcPa>> {
  if (!playerIds.length) return new Map()
  const CHUNK = 60
  const chunks = Array.from({ length: Math.ceil(playerIds.length / CHUNK) }, (_, i) =>
    playerIds.slice(i * CHUNK, (i + 1) * CHUNK)
  )
  const maps = await Promise.all(chunks.map(chunk => fetchWrcPaChunk(chunk, season)))
  const merged = new Map<number, PlayerWrcPa>()
  for (const m of maps) for (const [k, v] of m) merged.set(k, v)
  return merged
}

/** PA-weighted average wRC+ for a list of player IDs. */
export function weightedWrcAvg(ids: number[], wrcPaMap: Map<number, PlayerWrcPa>): number | null {
  let sumWrcPa = 0, sumPa = 0
  for (const id of ids) {
    const d = wrcPaMap.get(id)
    if (!d) continue
    sumWrcPa += d.wrc * d.pa
    sumPa    += d.pa
  }
  return sumPa === 0 ? null : Math.round(sumWrcPa / sumPa)
}

// ── Main export ───────────────────────────────────────────────────────────────

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

  // 3. Bulk wRC+ + PA fetch
  const wrcPaMap = await fetchWrcPaBulk([...allPlayerIds], season)

  // 4. PA-weighted avg per game side, keyed by gamePk
  const result = new Map<number, GameOffense>()
  for (const { gamePk, awayIds, homeIds } of gameData) {
    result.set(gamePk, {
      awayWrc:   weightedWrcAvg(awayIds, wrcPaMap),
      homeWrc:   weightedWrcAvg(homeIds, wrcPaMap),
      awayCount: awayIds.length,
      homeCount: homeIds.length,
    })
  }
  return result
}

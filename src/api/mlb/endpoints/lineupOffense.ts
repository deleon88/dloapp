import { mlbApi } from '../client'
import { fetchComputedWrcBulk } from './wrcComputed'
import type { RollingPeriod } from './handSplitsRollup'
export type { PlayerWrcData } from './wrcComputed'

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

export interface GameTeamIds {
  gamePk: number
  awayTeamId: number
  homeTeamId: number
  // Resolved hand for each side's wRC+ split — away batters vs the (home)
  // starter, home batters vs the (away) starter. Independent per side so
  // "vs Starter Hand" mode (each side resolves to whatever that game's actual
  // opposing starter throws) works, not just a single hand applied to both
  // sides of every game. null/undefined → unfiltered (season/period) value.
  awayHand?: 'L' | 'R' | null
  homeHand?: 'L' | 'R' | null
}

// ── Per-player wRC+ + PA (for PA-weighted averages) ───────────────────────────

export interface PlayerWrcPa {
  wrc: number; pa: number
  vsL?: number | null; paVsL?: number
  vsR?: number | null; paVsR?: number
}

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

/**
 * PA-weighted average wRC+ for a list of player IDs.
 * @param hand - optional 'L'|'R' to average the vsLHP/vsRHP split instead of the season value.
 */
export function weightedWrcAvg(
  ids: number[],
  wrcPaMap: Map<number, PlayerWrcPa>,
  hand?: 'L' | 'R',
): number | null {
  let sumWrcPa = 0, sumPa = 0
  for (const id of ids) {
    const d = wrcPaMap.get(id)
    if (!d) continue
    const wrc = hand === 'L' ? d.vsL : hand === 'R' ? d.vsR : d.wrc
    const pa  = hand === 'L' ? d.paVsL : hand === 'R' ? d.paVsR : d.pa
    if (wrc == null || !pa) continue
    sumWrcPa += wrc * pa
    sumPa    += pa
  }
  return sumPa === 0 ? null : Math.round(sumWrcPa / sumPa)
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns Map<gamePk, GameOffense> so doubleheaders (same teamId, different
 * gamePk) are handled correctly with their own lineups.
 *
 * @param cachedWrc - optional pre-resolved wRC+/PA per playerId (e.g. from
 * compute_lineup_status.py's server-computed hand-split cache, via
 * lineupStatusCache.ts). Players present here skip the live wRC+ fetch
 * entirely — only the remainder (unconfirmed lineups, or players the cache
 * doesn't cover) hits the live MLB API path, which is what makes toggling
 * the hand filter fast once the day's lineups are confirmed.
 */
export async function fetchLineupOffenseMap(
  games: GameTeamIds[],
  season = new Date().getFullYear(),
  startDate?: string,
  rollingPeriod?: RollingPeriod,
  cachedWrc?: Map<number, PlayerWrcPa>,
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
  const gameData: Array<{
    gamePk: number; awayIds: number[]; homeIds: number[]
    awayHand?: 'L' | 'R' | null; homeHand?: 'L' | 'R' | null
  }> = []
  const allPlayerIds = new Set<number>()
  const playerHomeTeamMap = new Map<number, number>()

  boxscores.forEach((bs, i) => {
    const { gamePk, homeTeamId, awayHand, homeHand } = games[i]
    const awayIds = bs?.teams.away.battingOrder ?? []
    const homeIds = bs?.teams.home.battingOrder ?? []
    gameData.push({ gamePk, awayIds, homeIds, awayHand, homeHand })
    awayIds.forEach(id => { allPlayerIds.add(id); playerHomeTeamMap.set(id, homeTeamId) })
    homeIds.forEach(id => { allPlayerIds.add(id); playerHomeTeamMap.set(id, homeTeamId) })
  })

  if (!allPlayerIds.size) return new Map()

  // 3. Park-adjusted wRC+ via computed formula — skip players already covered
  // by cachedWrc; only the remainder hits the live (potentially slow) path.
  // Fetches BOTH vsL and vsR per player regardless of any per-side hand
  // filter — the per-side hand selection happens in weightedWrcAvg below.
  const idsNeedingLive = cachedWrc
    ? [...allPlayerIds].filter(id => !cachedWrc.has(id))
    : [...allPlayerIds]
  const liveMap = idsNeedingLive.length
    ? await fetchWrcComputedBulk(idsNeedingLive, playerHomeTeamMap, undefined, season, startDate, rollingPeriod)
    : new Map<number, PlayerWrcPa>()
  const wrcPaMap = new Map<number, PlayerWrcPa>(cachedWrc)
  for (const [id, v] of liveMap) if (!wrcPaMap.has(id)) wrcPaMap.set(id, v)

  // 4. PA-weighted avg per game side, keyed by gamePk — each side uses its own
  // resolved hand (relevant for "vs Starter Hand": away vs home starter, home
  // vs away starter — two different hands within the same game).
  const result = new Map<number, GameOffense>()
  for (const { gamePk, awayIds, homeIds, awayHand, homeHand } of gameData) {
    result.set(gamePk, {
      awayWrc:   weightedWrcAvg(awayIds, wrcPaMap, awayHand ?? undefined),
      homeWrc:   weightedWrcAvg(homeIds, wrcPaMap, homeHand ?? undefined),
      awayCount: awayIds.length,
      homeCount: homeIds.length,
    })
  }
  return result
}

/**
 * Park-adjusted wRC+ drop-in replacement for fetchWrcPaBulk.
 * Returns the same Map<playerId, PlayerWrcPa> shape so existing callers
 * (SchedulePage, etc.) need no changes — they get the park-corrected number.
 *
 * @param homeTeamMap - playerId → homeTeamId (needed for park factor lookup)
 * @param batterHandMap - optional playerId → 'L'|'R' (enables handedness park factors on vs splits)
 */
export async function fetchWrcComputedBulk(
  playerIds: number[],
  homeTeamMap: Map<number, number>,
  batterHandMap?: Map<number, 'L' | 'R'>,
  season = new Date().getFullYear(),
  startDate?: string,
  rollingPeriod?: RollingPeriod,
): Promise<Map<number, PlayerWrcPa>> {
  const computed = await fetchComputedWrcBulk(playerIds, homeTeamMap, batterHandMap, season, startDate, rollingPeriod)
  const out = new Map<number, PlayerWrcPa>()
  for (const [id, d] of computed) {
    if (d.wrcPlus != null) {
      out.set(id, {
        wrc: d.wrcPlus, pa: d.pa,
        vsL: d.vsL, paVsL: d.paVsL,
        vsR: d.vsR, paVsR: d.paVsR,
      })
    }
  }
  return out
}

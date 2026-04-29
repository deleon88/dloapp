import { mlbApi } from '../client'
import { computeWrcPlus, type RawBattingStat } from '../wrcConstants'
import type { PlayerWrcPa } from './lineupOffense'

const FIELDS = [
  'people', 'id',
  'stats', 'type', 'displayName',
  'splits', 'stat',
  'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
  'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies', 'plateAppearances',
].join(',')

async function fetchChunk(
  ids: number[],
  startDate: string,
  endDate: string,
  season: number,
): Promise<Map<number, PlayerWrcPa>> {
  const data = await mlbApi.get<{
    people: Array<{
      id: number
      stats?: Array<{
        type: { displayName: string }
        splits: Array<{ stat: Record<string, unknown> }>
      }>
    }>
  }>('/people', {
    personIds: ids.join(','),
    hydrate: `stats(group=[hitting],type=[byDateRange],startDate=${startDate},endDate=${endDate},season=${season},gameType=R)`,
    fields: FIELDS,
  })

  const map = new Map<number, PlayerWrcPa>()
  for (const person of data.people ?? []) {
    for (const statBlock of person.stats ?? []) {
      if (statBlock.type?.displayName !== 'byDateRange') continue
      const split = statBlock.splits?.[0]
      if (!split) continue
      const raw = split.stat as unknown as RawBattingStat
      const wrc = computeWrcPlus(raw, season)
      if (wrc != null) {
        map.set(person.id, { wrc, pa: raw.plateAppearances ?? 1 })
      }
    }
  }
  return map
}

/**
 * Fetches wRC+ (derived from raw batting counts) for a date window.
 * Returns PlayerWrcPa, compatible with the existing weightedWrcAvg() from lineupOffense.ts.
 *
 * startDate / endDate: MM/DD/YYYY format.
 */
export async function fetchWrcByDateRange(
  playerIds: number[],
  startDate: string,
  endDate: string,
  season: number,
): Promise<Map<number, PlayerWrcPa>> {
  if (!playerIds.length) return new Map()
  const CHUNK = 60
  const chunks = Array.from({ length: Math.ceil(playerIds.length / CHUNK) }, (_, i) =>
    playerIds.slice(i * CHUNK, (i + 1) * CHUNK),
  )
  const maps = await Promise.all(chunks.map(c => fetchChunk(c, startDate, endDate, season)))
  const merged = new Map<number, PlayerWrcPa>()
  for (const m of maps) for (const [k, v] of m) merged.set(k, v)
  return merged
}

import { mlbApi } from '../client'
import { computeWrcPlus, type RawBattingStat } from '../wrcConstants'

export interface PlayerWrcByHand {
  vsRHP: number | null  // wRC+ when facing RHP (sitCode=vr)
  vsLHP: number | null  // wRC+ when facing LHP (sitCode=vl)
  paVsRHP: number
  paVsLHP: number
}

const FIELDS = [
  'people', 'id',
  'stats', 'type', 'displayName',
  'splits', 'split', 'code',
  'stat', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
  'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies', 'plateAppearances',
].join(',')

async function fetchChunk(ids: number[], season: number): Promise<Map<number, PlayerWrcByHand>> {
  const data = await mlbApi.get<{
    people: Array<{
      id: number
      stats?: Array<{
        type: { displayName: string }
        splits: Array<{
          split: { code: string }
          stat: Record<string, unknown>
        }>
      }>
    }>
  }>('/people', {
    personIds: ids.join(','),
    hydrate: `stats(group=[hitting],type=[statSplits],sitCodes=[vl,vr],season=${season},gameType=R)`,
    fields: FIELDS,
  })

  const map = new Map<number, PlayerWrcByHand>()
  for (const person of data.people ?? []) {
    const entry: PlayerWrcByHand = { vsRHP: null, vsLHP: null, paVsRHP: 0, paVsLHP: 0 }
    for (const statBlock of person.stats ?? []) {
      if (statBlock.type?.displayName !== 'statSplits') continue
      for (const split of statBlock.splits ?? []) {
        const code = split.split?.code
        const raw  = split.stat as unknown as RawBattingStat
        if (code === 'vl') {
          entry.vsLHP   = computeWrcPlus(raw, season)
          entry.paVsLHP = raw.plateAppearances ?? 0
        } else if (code === 'vr') {
          entry.vsRHP   = computeWrcPlus(raw, season)
          entry.paVsRHP = raw.plateAppearances ?? 0
        }
      }
    }
    map.set(person.id, entry)
  }
  return map
}

/** Bulk-fetches per-hand wRC+ for an arbitrary player list, chunked at 60. */
export async function fetchWrcByHandBulk(
  playerIds: number[],
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerWrcByHand>> {
  if (!playerIds.length) return new Map()
  const CHUNK = 60
  const chunks = Array.from({ length: Math.ceil(playerIds.length / CHUNK) }, (_, i) =>
    playerIds.slice(i * CHUNK, (i + 1) * CHUNK),
  )
  const maps = await Promise.all(chunks.map(c => fetchChunk(c, season)))
  const merged = new Map<number, PlayerWrcByHand>()
  for (const m of maps) for (const [k, v] of m) merged.set(k, v)
  return merged
}

/**
 * PA-weighted wRC+ for a list of players using the split matching the opponent's hand.
 *
 * opponentHand='R' → batters face RHP → use vsRHP (sitCode=vr)
 * opponentHand='L' → batters face LHP → use vsLHP (sitCode=vl)
 * opponentHand=undefined → defaults to vsRHP
 */
export function weightedWrcByHand(
  ids: number[],
  map: Map<number, PlayerWrcByHand>,
  opponentHand: 'R' | 'L' | undefined,
): number | null {
  let sumWrcPa = 0, sumPa = 0
  for (const id of ids) {
    const d = map.get(id)
    if (!d) continue
    const wrc = opponentHand === 'L' ? d.vsLHP : d.vsRHP
    const pa  = opponentHand === 'L' ? d.paVsLHP : d.paVsRHP
    if (wrc == null || pa === 0) continue
    sumWrcPa += wrc * pa
    sumPa    += pa
  }
  return sumPa === 0 ? null : Math.round(sumWrcPa / sumPa)
}

import { mlbApi } from '../client'

export interface VsPlayerStat {
  playerId: number
  hasHistory: boolean
  ab: number
  hits: number
  totalBases: number
  hbp: number
  sf: number
  hr: number
  rbi: number
  bb: number
  k: number
  avg: string | null
  slg: string | null
  obp: string | null
  ops: string | null
}

export async function getVsPlayerStats(
  playerIds: number[],
  opposingPlayerId: number,
): Promise<Map<number, VsPlayerStat>> {
  if (!playerIds.length) return new Map()

  const data = await mlbApi.get<{
    people: Array<{
      id: number
      stats: Array<{
        type: { displayName: string }
        totalSplits: number
        splits: Array<{
          stat: Record<string, unknown>
        }>
      }>
    }>
  }>('/people', {
    personIds: playerIds.join(','),
    sportId: 1,
    hydrate: `stats(group=[hitting],type=[vsPlayerTotal],opposingPlayerId=${opposingPlayerId},sportId=1)`,
  })

  const result = new Map<number, VsPlayerStat>()
  for (const person of data.people ?? []) {
    const vsTotal = person.stats?.find(s => s.type.displayName === 'vsPlayerTotal')
    const stat = vsTotal?.splits?.[0]?.stat ?? null
    result.set(person.id, {
      playerId:   person.id,
      hasHistory: (vsTotal?.totalSplits ?? 0) > 0,
      ab:         (stat?.atBats         as number) ?? 0,
      hits:       (stat?.hits           as number) ?? 0,
      totalBases: (stat?.totalBases     as number) ?? 0,
      hbp:        (stat?.hitByPitch     as number) ?? 0,
      sf:         (stat?.sacFlies       as number) ?? 0,
      hr:         (stat?.homeRuns       as number) ?? 0,
      rbi:        (stat?.rbi            as number) ?? 0,
      bb:         (stat?.baseOnBalls    as number) ?? 0,
      k:          (stat?.strikeOuts     as number) ?? 0,
      avg:        (stat?.avg            as string) ?? null,
      slg:        (stat?.slg            as string) ?? null,
      obp:        (stat?.obp            as string) ?? null,
      ops:        (stat?.ops            as string) ?? null,
    })
  }
  return result
}


import { mlbApi } from '../client'

export interface PlayerStats {
  wRcPlus: number | null
  ops: string | null
  woba: string | null   // formatted as ".348"
  xwoba: string | null  // formatted as ".443"
  pa: number | null
  hr: number | null
  rbi: number | null
  sb: number | null
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

export async function fetchLineupStats(
  playerIds: number[],
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerStats>> {
  if (!playerIds.length) return new Map()

  const data = await mlbApi.get<PeopleResponse>('/people', {
    personIds: playerIds.join(','),
    season,
    hydrate: `stats(group=[hitting],type=[season,sabermetrics,expectedStatistics],season=${season})`,
  })

  const map = new Map<number, PlayerStats>()

  for (const person of data.people ?? []) {
    const find = (type: string) =>
      person.stats?.find(s => s.type?.displayName === type)?.splits?.[0]?.stat ?? {}

    const s  = find('season')             as { ops?: string; plateAppearances?: number; homeRuns?: number; rbi?: number; stolenBases?: number }
    const sb = find('sabermetrics')       as { wRcPlus?: number; woba?: number }
    const xs = find('expectedStatistics') as { woba?: string }

    map.set(person.id, {
      wRcPlus: sb.wRcPlus != null ? Math.round(sb.wRcPlus) : null,
      ops:     s.ops ?? null,
      woba:    sb.woba != null ? fmtRate(sb.woba) : null,
      xwoba:   xs.woba ?? null,
      pa:      s.plateAppearances ?? null,
      hr:      s.homeRuns    ?? null,
      rbi:     s.rbi         ?? null,
      sb:      s.stolenBases ?? null,
    })
  }

  return map
}

// ── Legacy: wRcPlus-only map used by SchedulePage lineup offense ──────────────
const SABER_FIELDS = [
  'people', 'id',
  'stats', 'type', 'displayName', 'group',
  'splits', 'stat', 'wRcPlus',
].join(',')

interface LegacyPeopleResponse {
  people: Array<{
    id: number
    stats?: Array<{
      type: { displayName: string }
      group: { displayName: string }
      splits: Array<{ stat: { wRcPlus?: number } }>
    }>
  }>
}

export async function fetchLineupSabermetrics(
  playerIds: number[],
  season = new Date().getFullYear(),
): Promise<Map<number, number>> {
  if (!playerIds.length) return new Map()

  const data = await mlbApi.get<LegacyPeopleResponse>('/people', {
    personIds: playerIds.join(','),
    hydrate: `stats(group=[hitting],type=[sabermetrics],season=${season})`,
    fields: SABER_FIELDS,
  })

  const map = new Map<number, number>()
  for (const person of data.people ?? []) {
    const saber = person.stats?.find(
      s => s.type.displayName === 'sabermetrics' && s.group.displayName === 'hitting',
    )
    const wRcPlus = saber?.splits?.[0]?.stat?.wRcPlus
    if (wRcPlus != null) map.set(person.id, Math.round(wRcPlus))
  }
  return map
}

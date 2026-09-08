import { mlbApi } from '../client'
import { computeWoba, type RawBattingStat } from '../wrcConstants'

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

/**
 * OPS/HR/RBI/PA for a date range come straight from MLB's byDateRange hitting stat —
 * that combination works fine (the bug that forced a PBP rollup elsewhere is specific
 * to combining byDateRange WITH sitCodes/statSplits, which this endpoint never
 * requests). wOBA has no byDateRange-native field, so it's computed client-side from
 * the same block's raw counts via wrcConstants.ts's computeWoba, for consistency with
 * how the rest of the app derives wOBA. xwOBA isn't attempted here for date ranges —
 * savantStats.ts already covers it with a validated source; wRC+ likewise isn't
 * attempted here for date ranges — fetchComputedWrcBulk (wrcComputed.ts) already
 * covers it and callers already prioritize that source over this file's wRcPlus field.
 */
export async function fetchLineupStats(
  playerIds: number[],
  season = new Date().getFullYear(),
  startDate?: string,
): Promise<Map<number, PlayerStats>> {
  if (!playerIds.length) return new Map()

  const endDate = new Date().toISOString().split('T')[0]
  const hydrate = startDate
    ? `stats(group=[hitting],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
    : `stats(group=[hitting],type=[season,sabermetrics,expectedStatistics],season=${season})`

  const data = await mlbApi.get<PeopleResponse>('/people', {
    personIds: playerIds.join(','),
    season,
    hydrate,
    fields: [
      'people', 'id',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'ops', 'woba', 'plateAppearances', 'homeRuns', 'rbi', 'stolenBases', 'wRcPlus',
      'atBats', 'hits', 'doubles', 'triples', 'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies',
    ].join(','),
  })

  const map = new Map<number, PlayerStats>()

  for (const person of data.people ?? []) {
    const find = (type: string) =>
      person.stats?.find(s => s.type?.displayName === type)?.splits?.[0]?.stat ?? {}

    if (startDate) {
      const d = find('byDateRange') as {
        ops?: string; plateAppearances?: number; homeRuns?: number; rbi?: number; stolenBases?: number
        atBats?: number; hits?: number; doubles?: number; triples?: number
        baseOnBalls?: number; intentionalWalks?: number; hitByPitch?: number; sacFlies?: number
      }
      const raw: RawBattingStat = {
        atBats:           d.atBats           ?? 0,
        hits:             d.hits             ?? 0,
        doubles:          d.doubles          ?? 0,
        triples:          d.triples          ?? 0,
        homeRuns:         d.homeRuns         ?? 0,
        baseOnBalls:      d.baseOnBalls      ?? 0,
        intentionalWalks: d.intentionalWalks ?? 0,
        hitByPitch:       d.hitByPitch       ?? 0,
        sacFlies:         d.sacFlies         ?? 0,
        plateAppearances: d.plateAppearances ?? 0,
      }
      map.set(person.id, {
        wRcPlus: null,   // fetchComputedWrcBulk already covers this for date ranges, with priority
        ops:     d.ops ?? null,
        woba:    raw.plateAppearances > 0 ? fmtRate(computeWoba(raw, season)) : null,
        xwoba:   null,   // savantStats.ts already covers this for date ranges, with priority
        pa:      d.plateAppearances ?? null,
        hr:      d.homeRuns    ?? null,
        rbi:     d.rbi         ?? null,
        sb:      d.stolenBases ?? null,
      })
      continue
    }

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

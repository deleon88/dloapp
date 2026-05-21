import { mlbApi } from '../client'
import { computeWrcPlus, type RawBattingStat } from '../wrcConstants'
import { getParkInfo, getHandednessParkFactor } from './parkFactors'
import { fetchLeagueContext } from './leagueContext'

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlayerWrcData {
  pa:       number
  wrcPlus:  number | null   // season wRC+, park-adjusted using API wRaa
  vsL:      number | null   // vs-LHP wRC+, park-adjusted with handedness PF
  vsR:      number | null   // vs-RHP wRC+, park-adjusted with handedness PF
  paVsL:    number
  paVsR:    number
}

// ── Internal API response types ───────────────────────────────────────────────

interface RawSplit {
  split?: { code?: string }
  stat?:  Record<string, unknown>
}

interface RawStatGroup {
  type:   { displayName: string }
  group?: { displayName: string }
  splits?: RawSplit[]
}

interface RawPerson {
  id:     number
  stats?: RawStatGroup[]
}

interface RawPeopleResponse {
  people?: RawPerson[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 60

function toRawBatting(stat: Record<string, unknown>): RawBattingStat {
  const n = (k: string) => (typeof stat[k] === 'number' ? (stat[k] as number) : 0)
  return {
    atBats:           n('atBats'),
    hits:             n('hits'),
    doubles:          n('doubles'),
    triples:          n('triples'),
    homeRuns:         n('homeRuns'),
    baseOnBalls:      n('baseOnBalls'),
    intentionalWalks: n('intentionalWalks'),
    hitByPitch:       n('hitByPitch'),
    sacFlies:         n('sacFlies'),
    plateAppearances: n('plateAppearances'),
  }
}

async function fetchChunk(
  ids: number[],
  season: number,
): Promise<Map<number, { season: RawSplit | null; sabermetrics: RawSplit | null; vsL: RawSplit | null; vsR: RawSplit | null }>> {
  const data = await mlbApi.get<RawPeopleResponse>('/people', {
    personIds: ids.join(','),
    season,
    hydrate: `stats(group=[hitting],type=[season,sabermetrics,statSplits],sitCodes=[vl,vr],season=${season})`,
    fields: [
      'people', 'id',
      'stats', 'type', 'displayName', 'group', 'splits', 'split', 'code', 'stat',
      'wRaa', 'plateAppearances',
      'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
      'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies',
    ].join(','),
  })

  const result = new Map<number, { season: RawSplit | null; sabermetrics: RawSplit | null; vsL: RawSplit | null; vsR: RawSplit | null }>()

  for (const person of data.people ?? []) {
    const byType = new Map<string, RawStatGroup>()
    for (const g of person.stats ?? []) byType.set(g.type.displayName, g)

    const seasonGroup = byType.get('season')?.splits?.[0] ?? null
    const saberGroup  = byType.get('sabermetrics')?.splits?.[0] ?? null
    const splitGroup  = byType.get('statSplits')

    let vsL: RawSplit | null = null
    let vsR: RawSplit | null = null
    for (const s of splitGroup?.splits ?? []) {
      const code = s.split?.code
      if (code === 'vl') vsL = s
      if (code === 'vr') vsR = s
    }

    result.set(person.id, { season: seasonGroup, sabermetrics: saberGroup, vsL, vsR })
  }

  return result
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches park-adjusted wRC+ for a list of players.
 *
 * @param playerIds     - MLB player IDs to fetch
 * @param homeTeamMap   - Map from playerId → that player's home teamId (for park factor lookup)
 * @param batterHandMap - Optional map from playerId → bat hand ('L'|'R') for handedness-specific park factors on vs-splits
 * @param season        - MLB season year (defaults to current year)
 */
export async function fetchComputedWrcBulk(
  playerIds: number[],
  homeTeamMap: Map<number, number>,
  batterHandMap?: Map<number, 'L' | 'R'>,
  season = new Date().getFullYear(),
): Promise<Map<number, PlayerWrcData>> {
  if (!playerIds.length) return new Map()

  const [lgCtx, ...chunkMaps] = await Promise.all([
    fetchLeagueContext(season),
    ...Array.from({ length: Math.ceil(playerIds.length / CHUNK_SIZE) }, (_, i) =>
      fetchChunk(playerIds.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), season)
    ),
  ])

  const raw = new Map<number, { season: RawSplit | null; sabermetrics: RawSplit | null; vsL: RawSplit | null; vsR: RawSplit | null }>()
  for (const m of chunkMaps) for (const [k, v] of m) raw.set(k, v)

  const result = new Map<number, PlayerWrcData>()
  const lgRpa  = lgCtx.lgRpa

  for (const id of playerIds) {
    const splits = raw.get(id)
    if (!splits) continue

    const homeTeamId  = homeTeamMap.get(id)
    const batterHand  = batterHandMap?.get(id)
    const basicPF     = homeTeamId != null ? getParkInfo(homeTeamId).factor : 1.00
    const handPF      = homeTeamId != null ? getHandednessParkFactor(homeTeamId, batterHand) : 1.00

    // ── Season wRC+ from API wRaa ───────────────────────────────────────────
    const seasonStat   = splits.season?.stat   as Record<string, unknown> | undefined
    const saberStat    = splits.sabermetrics?.stat as Record<string, unknown> | undefined
    const pa           = typeof seasonStat?.plateAppearances === 'number' ? seasonStat.plateAppearances : 0
    const wRaa         = typeof saberStat?.wRaa === 'number' ? saberStat.wRaa : null

    let wrcPlus: number | null = null
    if (wRaa != null && pa > 0 && lgRpa > 0) {
      wrcPlus = Math.round((wRaa / pa / lgRpa + (2 - basicPF)) * 100)
    }

    // ── vs-L wRC+ from raw split counts ────────────────────────────────────
    let vsL: number | null = null
    let paVsL = 0
    if (splits.vsL?.stat) {
      const raw = toRawBatting(splits.vsL.stat as Record<string, unknown>)
      paVsL  = raw.plateAppearances
      vsL    = computeWrcPlus(raw, season, handPF)
    }

    // ── vs-R wRC+ from raw split counts ────────────────────────────────────
    let vsR: number | null = null
    let paVsR = 0
    if (splits.vsR?.stat) {
      const raw = toRawBatting(splits.vsR.stat as Record<string, unknown>)
      paVsR = raw.plateAppearances
      vsR   = computeWrcPlus(raw, season, handPF)
    }

    result.set(id, { pa, wrcPlus, vsL, vsR, paVsL, paVsR })
  }

  return result
}

import { mlbApi } from '../client'
import { computeWrcPlus, computeWoba, computeOps, loadLiveConstants, type RawBattingStat } from '../wrcConstants'
import { getParkInfo, getHandednessParkFactor } from './parkFactors'
import { fetchLeagueContext } from './leagueContext'
import { loadHandSplitsRollup, getBatterHandSplitRaw, getBatterHandSplitRbi, type RollingPeriod } from './handSplitsRollup'
import { todayStr } from '@/utils/period'

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlayerWrcData {
  pa:       number
  wrcPlus:  number | null   // season wRC+, park-adjusted from raw batting counts
  vsL:      number | null   // vs-LHP wRC+, park-adjusted with handedness PF
  vsR:      number | null   // vs-RHP wRC+, park-adjusted with handedness PF
  paVsL:    number
  paVsR:    number
  // Hand-split supplemental stats — same raw counts as vsL/vsR above, so every
  // batter stat shown in the UI (not just wRC+/the bars) responds to the hand
  // filter. opsVsL/opsVsR come straight from MLB's own `ops` field on the
  // season split; the rolling-window path has no such field so it's derived
  // via computeOps() from the same raw counts used for vsL/vsR.
  opsVsL:   number | null
  opsVsR:   number | null
  wobaVsL:  number | null
  wobaVsR:  number | null
  hrVsL:    number | null
  hrVsR:    number | null
  rbiVsL:   number | null
  rbiVsR:   number | null
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

type ChunkEntry = { season: RawSplit | null; vsL: RawSplit | null; vsR: RawSplit | null }

/**
 * Season path (no startDate): type=[season,statSplits],sitCodes=[vl,vr] in one hydrate
 * — MLB Stats API genuinely supports this combination correctly at season granularity
 * (validated against real FanGraphs wRC+ splits, MAE ~1 point).
 *
 * Rolling-window path (startDate set): ONLY type=[byDateRange] for the all-hands
 * number — sitCodes=[vl,vr] is deliberately NOT requested here anymore. Verified
 * empirically that MLB's statSplits/sitCodes silently ignores startDate/endDate even
 * when combined with byDateRange in the same call (returns season-to-date totals
 * mislabeled as the requested window) — vsL/vsR for rolling windows come from the
 * PBP-derived rollup (handSplitsRollup.ts) instead, via fetchComputedWrcBulk below.
 */
async function fetchChunk(
  ids: number[],
  season: number,
  startDate?: string,
): Promise<Map<number, ChunkEntry>> {
  const endDate = todayStr()
  const hydrate = startDate
    ? `stats(group=[hitting],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
    : `stats(group=[hitting],type=[season,statSplits],sitCodes=[vl,vr],season=${season})`
  const data = await mlbApi.get<RawPeopleResponse>('/people', {
    personIds: ids.join(','),
    season,
    hydrate,
    fields: [
      'people', 'id',
      'stats', 'type', 'displayName', 'group', 'splits', 'split', 'code', 'stat',
      'plateAppearances',
      'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
      'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies',
      'ops', 'rbi',
    ].join(','),
  })

  const result = new Map<number, ChunkEntry>()

  for (const person of data.people ?? []) {
    const byType = new Map<string, RawStatGroup>()
    for (const g of person.stats ?? []) byType.set(g.type.displayName, g)

    const seasonGroup = (byType.get(startDate ? 'byDateRange' : 'season'))?.splits?.[0] ?? null
    const splitGroup  = startDate ? undefined : byType.get('statSplits')

    let vsL: RawSplit | null = null
    let vsR: RawSplit | null = null
    for (const s of splitGroup?.splits ?? []) {
      const code = s.split?.code
      if (code === 'vl') vsL = s
      if (code === 'vr') vsR = s
    }

    result.set(person.id, { season: seasonGroup, vsL, vsR })
  }

  return result
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetches park-adjusted wRC+ for a list of players, computed from raw batting counts.
 * Works for full season and any date range — no sabermetrics dependency.
 *
 * @param playerIds     - MLB player IDs to fetch
 * @param homeTeamMap   - Map from playerId → that player's home teamId (for park factor lookup)
 * @param batterHandMap - Optional map from playerId → bat hand ('L'|'R') for handedness-specific park factors on vs-splits
 * @param season        - MLB season year (defaults to current year)
 * @param startDate     - Optional start date string 'YYYY-MM-DD' for date-range stats
 * @param rollingPeriod - Which rolling window `startDate` corresponds to ('60days' etc) —
 *                        required (alongside startDate) to source vsL/vsR from the
 *                        PBP-derived rollup; without it, rolling-window vsL/vsR come back
 *                        null rather than falling back to stale season-wide numbers.
 */
export async function fetchComputedWrcBulk(
  playerIds: number[],
  homeTeamMap: Map<number, number>,
  batterHandMap?: Map<number, 'L' | 'R'>,
  season = new Date().getFullYear(),
  startDate?: string,
  rollingPeriod?: RollingPeriod,
): Promise<Map<number, PlayerWrcData>> {
  if (!playerIds.length) return new Map()

  await loadLiveConstants(season)

  const [lgCtx, rollup, ...chunkMaps] = await Promise.all([
    fetchLeagueContext(season),
    (startDate && rollingPeriod) ? loadHandSplitsRollup(season) : Promise.resolve(null),
    ...Array.from({ length: Math.ceil(playerIds.length / CHUNK_SIZE) }, (_, i) =>
      fetchChunk(playerIds.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), season, startDate)
    ),
  ])

  const raw = new Map<number, ChunkEntry>()
  for (const m of chunkMaps) for (const [k, v] of m) raw.set(k, v)

  const result = new Map<number, PlayerWrcData>()

  for (const id of playerIds) {
    const splits = raw.get(id)
    if (!splits) continue

    const homeTeamId  = homeTeamMap.get(id)
    const batterHand  = batterHandMap?.get(id)
    const basicPF     = homeTeamId != null ? getParkInfo(homeTeamId).factor : 1.00
    const handPF      = homeTeamId != null ? getHandednessParkFactor(homeTeamId, batterHand) : 1.00

    // Season wRC+ from raw batting counts
    const seasonRaw = splits.season?.stat ? toRawBatting(splits.season.stat as Record<string, unknown>) : null
    const pa        = seasonRaw?.plateAppearances ?? 0
    const wrcPlus   = seasonRaw && pa > 0 ? computeWrcPlus(seasonRaw, season, basicPF, lgCtx) : null

    let vsL: number | null = null
    let paVsL = 0
    let vsR: number | null = null
    let paVsR = 0
    let opsVsL: number | null = null
    let opsVsR: number | null = null
    let wobaVsL: number | null = null
    let wobaVsR: number | null = null
    let hrVsL: number | null = null
    let hrVsR: number | null = null
    let rbiVsL: number | null = null
    let rbiVsR: number | null = null

    if (startDate && rollingPeriod) {
      // Rolling window — vsL/vsR from the PBP rollup, no minimum-sample gate (minPA=0,
      // product decision: a tiny sample still shows a real number, never a stale one).
      // OPS/wOBA have no MLB-supplied field for a PBP-derived split, so they're
      // derived from the same raw counts already fetched for wRC+.
      const rawL = getBatterHandSplitRaw(rollup, id, 'L', rollingPeriod)
      if (rawL) {
        paVsL   = rawL.plateAppearances
        vsL     = computeWrcPlus(rawL, season, handPF, lgCtx, 0)
        opsVsL  = computeOps(rawL)
        wobaVsL = paVsL > 0 ? computeWoba(rawL, season) : null
        hrVsL   = rawL.homeRuns
        rbiVsL  = getBatterHandSplitRbi(rollup, id, 'L', rollingPeriod)
      }
      const rawR = getBatterHandSplitRaw(rollup, id, 'R', rollingPeriod)
      if (rawR) {
        paVsR   = rawR.plateAppearances
        vsR     = computeWrcPlus(rawR, season, handPF, lgCtx, 0)
        opsVsR  = computeOps(rawR)
        wobaVsR = paVsR > 0 ? computeWoba(rawR, season) : null
        hrVsR   = rawR.homeRuns
        rbiVsR  = getBatterHandSplitRbi(rollup, id, 'R', rollingPeriod)
      }
    } else if (splits.vsL?.stat || splits.vsR?.stat) {
      // Season path — vs-L/vs-R wRC+ from MLB's own sitCodes split, unchanged.
      // OPS comes straight from MLB's own `ops` field on that same split.
      if (splits.vsL?.stat) {
        const statL = splits.vsL.stat as Record<string, unknown>
        const rawL  = toRawBatting(statL)
        paVsL   = rawL.plateAppearances
        vsL     = computeWrcPlus(rawL, season, handPF, lgCtx)
        opsVsL  = typeof statL.ops === 'string' && Number.isFinite(parseFloat(statL.ops)) ? parseFloat(statL.ops) : null
        wobaVsL = paVsL > 0 ? computeWoba(rawL, season) : null
        hrVsL   = rawL.homeRuns
        rbiVsL  = typeof statL.rbi === 'number' ? statL.rbi : null
      }
      if (splits.vsR?.stat) {
        const statR = splits.vsR.stat as Record<string, unknown>
        const rawR  = toRawBatting(statR)
        paVsR   = rawR.plateAppearances
        vsR     = computeWrcPlus(rawR, season, handPF, lgCtx)
        opsVsR  = typeof statR.ops === 'string' && Number.isFinite(parseFloat(statR.ops)) ? parseFloat(statR.ops) : null
        wobaVsR = paVsR > 0 ? computeWoba(rawR, season) : null
        hrVsR   = rawR.homeRuns
        rbiVsR  = typeof statR.rbi === 'number' ? statR.rbi : null
      }
    }

    result.set(id, {
      pa, wrcPlus, vsL, vsR, paVsL, paVsR,
      opsVsL, opsVsR, wobaVsL, wobaVsR, hrVsL, hrVsR, rbiVsL, rbiVsR,
    })
  }

  return result
}

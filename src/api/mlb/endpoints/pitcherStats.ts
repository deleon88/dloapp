import { mlbApi } from '../client'

export interface PitcherSeasonStats {
  era: string
  whip: string
  wins: number
  losses: number
  inningsPitched: string
  strikeoutsPer9Inn: string
  walksPer9Inn: string
  strikeoutWalkRatio: string
  runsScoredPer9: string
  strikeOuts: number
  baseOnBalls: number
  battersFaced: number
  fip: number
  fipMinus: number
  xfip: number
  woba: string
  wobaCon: string
  qualityStarts: number
  inningsPitchedPerGame: string
}

/** Convert FIP- to FIP+ so higher = better (mirrors OPS+ scale). */
export function fipPlus(fipMinus: number): number {
  return Math.round(200 - fipMinus)
}

export interface PitcherInfo {
  id: number
  fullName: string
  primaryNumber?: string
  pitchHand?: string
  seasonStats?: PitcherSeasonStats
}

interface StatEntry {
  type: { displayName: string }
  splits: Array<{ stat: Record<string, unknown> }>
}

interface RawPerson {
  id: number
  fullName: string
  primaryNumber?: string
  pitchHand?: { code: string }
  stats?: StatEntry[]
}

export async function fetchPitcherStats(personIds: number[]): Promise<Map<number, PitcherInfo>> {
  if (!personIds.length) return new Map()

  const season = new Date().getFullYear()

  const data = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: personIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[season,seasonAdvanced,sabermetrics,expectedStatistics],season=${season})`,
    fields: [
      'people', 'id', 'fullName', 'primaryNumber',
      'pitchHand', 'code', 'description',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'era', 'inningsPitched', 'wins', 'losses', 'whip',
      'strikeOuts', 'baseOnBalls', 'battersFaced', 'strikeoutsPer9Inn',
      'walksPer9Inn', 'strikeoutWalkRatio', 'runsScoredPer9',
      'fip', 'fipMinus', 'xfip',
      'woba', 'wobaCon',
      'qualityStarts', 'inningsPitchedPerGame',
    ].join(','),
  })

  const map = new Map<number, PitcherInfo>()
  for (const p of data.people ?? []) {
    const byType = new Map(
      (p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}])
    )

    type SeasonStat = {
      era?: string; whip?: string; wins?: number; losses?: number
      inningsPitched?: string; strikeoutsPer9Inn?: string; walksPer9Inn?: string
      strikeoutWalkRatio?: string; runsScoredPer9?: string
      strikeOuts?: number; baseOnBalls?: number; battersFaced?: number
    }
    type AdvancedStat  = { qualityStarts?: number; inningsPitchedPerGame?: string }
    type SaberStat     = { fip?: number; fipMinus?: number; xfip?: number }
    type ExpStat       = { woba?: string; wobaCon?: string }

    const ss  = (byType.get('season')             ?? {}) as SeasonStat
    const adv = (byType.get('seasonAdvanced')     ?? {}) as AdvancedStat
    const sb  = (byType.get('sabermetrics')       ?? {}) as SaberStat
    const ex  = (byType.get('expectedStatistics') ?? {}) as ExpStat

    map.set(p.id, {
      id: p.id,
      fullName: p.fullName,
      primaryNumber: p.primaryNumber,
      pitchHand: p.pitchHand?.code,
      seasonStats: ss.era != null ? {
        era:                  ss.era                  ?? '-.--',
        whip:                 ss.whip                 ?? '-.--',
        wins:                 ss.wins                 ?? 0,
        losses:               ss.losses               ?? 0,
        inningsPitched:       ss.inningsPitched        ?? '0.0',
        strikeoutsPer9Inn:    ss.strikeoutsPer9Inn     ?? '0.0',
        walksPer9Inn:         ss.walksPer9Inn          ?? '0.0',
        strikeoutWalkRatio:   ss.strikeoutWalkRatio    ?? '—',
        runsScoredPer9:       ss.runsScoredPer9        ?? '0.0',
        strikeOuts:           ss.strikeOuts            ?? 0,
        baseOnBalls:          ss.baseOnBalls           ?? 0,
        battersFaced:         ss.battersFaced          ?? 0,
        fip:                  sb.fip                   ?? 0,
        fipMinus:             sb.fipMinus              ?? 0,
        xfip:                 sb.xfip                  ?? 0,
        woba:                 ex.woba                  ?? '-.---',
        wobaCon:              ex.wobaCon               ?? '-.---',
        qualityStarts:        adv.qualityStarts        ?? 0,
        inningsPitchedPerGame: adv.inningsPitchedPerGame ?? '0.0',
      } : undefined,
    })
  }
  return map
}

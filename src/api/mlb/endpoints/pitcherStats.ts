import { mlbApi } from '../client'
import { fetchPitcherLines, formatIp, type PitcherSplit } from '@/api/stats/pitchers'
import type { StatPeriod } from '@/utils/period'

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
  qualityStarts: number
  inningsPitchedPerGame: string
  /** wOBA allowed, from our backend (same period / hand as FIP). */
  wobaAgainst?: number | null
  /** OPS+ allowed (see PitcherSplit); shown instead of ERA with a batter-hand filter. */
  opsPlusAgainst?: number | null
  /** Set by applyPitcherHand: these numbers are vs this batter hand only. */
  vsHand?: 'L' | 'R'
  /** Lines vs LHB / vs RHB for the same period, for the hand filter (see applyPitcherHand). */
  byHand?: { L: PitcherSplit; R: PitcherSplit }
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

/**
 * Starter pitcher info and stats. Name and hand come from MLB;
 * FIP, FIP-, xFIP, WHIP, K, BB, IP and ERA/W-L/QS follow the chosen period via
 * our backend. If the backend fails in full season, MLB's numbers are kept;
 * in a shorter period they're left empty rather than mixing periods.
 */
export async function fetchPitcherStats(
  personIds: number[],
  period: StatPeriod = 'season',
): Promise<Map<number, PitcherInfo>> {
  if (!personIds.length) return new Map()

  const season = new Date().getFullYear()
  const oursPromise = fetchPitcherLines(personIds, { season, period }).catch(() => null)

  const data = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: personIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[season,seasonAdvanced,sabermetrics],season=${season})`,
    fields: [
      'people', 'id', 'fullName', 'primaryNumber',
      'pitchHand', 'code', 'description',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'era', 'inningsPitched', 'wins', 'losses', 'whip',
      'strikeOuts', 'baseOnBalls', 'battersFaced', 'strikeoutsPer9Inn',
      'walksPer9Inn', 'strikeoutWalkRatio', 'runsScoredPer9',
      'fip', 'fipMinus', 'xfip',
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

    const ss  = (byType.get('season')             ?? {}) as SeasonStat
    const adv = (byType.get('seasonAdvanced')     ?? {}) as AdvancedStat
    const sb  = (byType.get('sabermetrics')       ?? {}) as SaberStat

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
        qualityStarts:        adv.qualityStarts        ?? 0,
        inningsPitchedPerGame: adv.inningsPitchedPerGame ?? '0.0',
      } : undefined,
    })
  }

  const ours = await oursPromise
  if (!ours && period === 'season') return map

  for (const info of map.values()) {
    const line = ours?.get(info.id)
    if (!line) {
      // No appearances in the window (or backend down in a short period): no numbers.
      if (info.seasonStats && period !== 'season') info.seasonStats = undefined
      continue
    }
    const base: PitcherSeasonStats = info.seasonStats ?? {
      era: '-.--', whip: '-.--', wins: 0, losses: 0, inningsPitched: '0.0', strikeoutsPer9Inn: '0.0',
      walksPer9Inn: '0.0', strikeoutWalkRatio: '—', runsScoredPer9: '0.0', strikeOuts: 0, baseOnBalls: 0,
      battersFaced: 0, fip: 0, fipMinus: 0, xfip: 0, qualityStarts: 0,
      inningsPitchedPerGame: '0.0',
    }
    info.seasonStats = {
      ...base,
      ...splitToStats(line),
      era:           line.record?.era ?? '-.--',
      wins:          line.record?.wins ?? base.wins,
      losses:        line.record?.losses ?? base.losses,
      qualityStarts: line.record?.qualityStarts ?? (period === 'season' ? base.qualityStarts : 0),
      byHand:        { L: line.vsL, R: line.vsR },
    }
  }
  return map
}

/** Our split → the fields of PitcherSeasonStats it replaces. */
function splitToStats(s: PitcherSplit): Partial<PitcherSeasonStats> {
  return {
    fip:            s.fip ?? 0,
    fipMinus:       s.fipMinus ?? 0,
    xfip:           s.xfip ?? 0,
    whip:           s.whip != null ? s.whip.toFixed(2) : '-.--',
    strikeOuts:     s.so,
    baseOnBalls:    s.bb,
    battersFaced:   s.bf,
    inningsPitched: formatIp(s.ip),
    wobaAgainst:    s.wobaAgainst,
    opsPlusAgainst: s.opsPlusAgainst,
  }
}

/**
 * Switches each pitcher to his line vs the given batter hand. ERA can't be split
 * by batter hand (MLB doesn't publish it), so it's emptied; the card shows OPS+
 * against in its place.
 */
export function applyPitcherHand(
  pitchers: Map<number, PitcherInfo>,
  hand: 'L' | 'R',
): Map<number, PitcherInfo> {
  const out = new Map<number, PitcherInfo>()
  for (const [id, info] of pitchers) {
    const s = info.seasonStats
    const split = s?.byHand?.[hand]
    out.set(id, {
      ...info,
      seasonStats: s && split ? { ...s, ...splitToStats(split), era: '-.--', vsHand: hand } : undefined,
    })
  }
  return out
}

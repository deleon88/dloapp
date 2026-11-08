// The pitcher card guide's numbers: the league average of each stat the card
// shows, and tier cut-offs from how the season's pitchers are spread around it.
import { getPitchingLeaders, type PitcherRow } from '../leaders/leaders.js'
import { getConstants } from './batting.js'
import { constantsSource, type League } from '../leagues.js'
import type { PitchingConstants } from './formulas.js'

export type GuideStat = 'era' | 'fip' | 'xfip' | 'whip' | 'kbb' | 'woba'

export interface PitchingGuide {
  season: number
  /** Pitchers the tiers come from (≥ MIN_BF batters faced). */
  pitchers: number
  /** League average, all pitchers. */
  avg: Record<GuideStat, number>
  /**
   * Six cut-offs around the average, best first: excellent, great, above |
   * below, poor, awful = the 10th, 20th, 35th | 65th, 80th, 90th percentile,
   * best to worst, of the batters faced by pitchers with a real sample.
   */
  tiers: Record<GuideStat, [number, number, number, number, number, number]>
}

const LOWER_BETTER: Record<GuideStat, boolean> = { era: true, fip: true, xfip: true, whip: true, kbb: false, woba: true }
const CUTS = [0.1, 0.2, 0.35, 0.65, 0.8, 0.9]
const MIN_BF = 100

const get: Record<GuideStat, (r: PitcherRow) => number | null | undefined> = {
  era: r => r.era, fip: r => r.fip, xfip: r => r.xfip, whip: r => r.whip, kbb: r => r.kbbPct, woba: r => r.wobaAgainst,
}

export async function getPitchingGuide(season: number, league: League = 'MLB'): Promise<PitchingGuide> {
  const [all, k] = await Promise.all([
    getPitchingLeaders({ league, season }),
    getConstants(season, constantsSource(league)) as Promise<PitchingConstants>,
  ])

  // League line: each rate stat weighted by innings over every pitcher (= the
  // league's own line). FIP and xFIP land on league ERA by construction (cFIP)
  // but are measured, not assumed; wOBA against is the league wOBA.
  const sum = (f: (r: PitcherRow) => number) => all.players.reduce((n, r) => n + f(r), 0)
  const ip = sum(r => r.ip), bf = sum(r => r.bf)
  const perIp = (f: (r: PitcherRow) => number | null | undefined) => {
    const has = all.players.filter(r => f(r) != null)
    return has.reduce((n, r) => n + f(r)! * r.ip, 0) / has.reduce((n, r) => n + r.ip, 0)
  }
  const avg: Record<GuideStat, number> = {
    era: perIp(r => r.era), fip: perIp(r => r.fip), xfip: perIp(r => r.xfip),
    whip: (sum(r => r.bb) + sum(r => r.h)) / ip,
    kbb: ((sum(r => r.so) - sum(r => r.bb)) / bf) * 100,
    woba: k.lgwOBA,
  }

  // Percentiles over the batters faced: every pitcher with a real sample, each
  // weighing what he pitched, so the middle lands on the league average.
  const pool = all.players.filter(r => r.bf >= MIN_BF)
  const tiers = {} as PitchingGuide['tiers']
  for (const stat of Object.keys(get) as GuideStat[]) {
    const vals = pool.map(r => ({ v: get[stat](r), w: r.bf }))
      .filter((x): x is { v: number; w: number } => x.v != null && Number.isFinite(x.v))
      .sort((a, b) => (LOWER_BETTER[stat] ? a.v - b.v : b.v - a.v))   // best first
    const total = vals.reduce((n, x) => n + x.w, 0)
    tiers[stat] = CUTS.map(q => {
      let acc = 0
      for (const x of vals) { acc += x.w; if (acc >= q * total) return x.v }
      return vals[vals.length - 1].v
    }) as PitchingGuide['tiers'][GuideStat]
  }
  return { season, pitchers: pool.length, avg, tiers }
}

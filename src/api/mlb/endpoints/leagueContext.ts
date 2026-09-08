import { mlbApi } from '../client'
import { computeWoba, loadLiveConstants, type RawBattingStat } from '../wrcConstants'

export interface LeagueContext {
  lgRpa:  number   // league runs per plate appearance
  lgwOBA: number   // league wOBA (weights applied to aggregate counting stats)
}

interface RawTeamStatSplit {
  stat?: {
    runs?:             number
    plateAppearances?: number
    atBats?:           number
    hits?:             number
    doubles?:          number
    triples?:          number
    homeRuns?:         number
    baseOnBalls?:      number
    intentionalWalks?: number
    hitByPitch?:       number
    sacFlies?:         number
  }
}

interface RawTeamsStatsResponse {
  stats?: Array<{
    splits?: RawTeamStatSplit[]
  }>
}

/**
 * Fetches live league R/PA and wOBA for the season by summing all 30 team hitting splits.
 * lgwOBA is computed by applying the season's FanGraphs linear weights to the league's
 * aggregate counting stats — the same method FanGraphs uses, so it tracks their published
 * value without scraping.
 * Falls back to hardcoded FanGraphs constants on error.
 */
export async function fetchLeagueContext(season: number): Promise<LeagueContext> {
  await loadLiveConstants(season)
  try {
    const data = await mlbApi.get<RawTeamsStatsResponse>('/teams/stats', {
      group:    'hitting',
      season,
      sportIds: 1,
      gameType: 'R',
      stats:    'season',
      fields:   [
        'stats', 'splits', 'stat',
        'runs', 'plateAppearances',
        'atBats', 'hits', 'doubles', 'triples', 'homeRuns',
        'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies',
      ].join(','),
    })

    const totals: RawBattingStat & { runs: number } = {
      runs: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0,
      baseOnBalls: 0, intentionalWalks: 0, hitByPitch: 0, sacFlies: 0,
      plateAppearances: 0,
    }

    for (const statGroup of data.stats ?? []) {
      for (const split of statGroup.splits ?? []) {
        const s = split.stat ?? {}
        totals.runs             += s.runs             ?? 0
        totals.plateAppearances += s.plateAppearances ?? 0
        totals.atBats           += s.atBats           ?? 0
        totals.hits             += s.hits             ?? 0
        totals.doubles          += s.doubles          ?? 0
        totals.triples          += s.triples          ?? 0
        totals.homeRuns         += s.homeRuns         ?? 0
        totals.baseOnBalls      += s.baseOnBalls      ?? 0
        totals.intentionalWalks += s.intentionalWalks ?? 0
        totals.hitByPitch       += s.hitByPitch       ?? 0
        totals.sacFlies         += s.sacFlies         ?? 0
      }
    }

    if (totals.plateAppearances > 0) {
      return {
        lgRpa:  totals.runs / totals.plateAppearances,
        lgwOBA: computeWoba(totals, season),
      }
    }
  } catch {
    // fall through to constants
  }

  // FanGraphs 2026 fallback
  return { lgRpa: 0.116, lgwOBA: 0.316 }
}

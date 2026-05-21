import { mlbApi } from '../client'

export interface LeagueContext {
  lgRpa: number   // league runs per plate appearance
}

interface RawTeamStatSplit {
  stat?: {
    runs?: number
    plateAppearances?: number
  }
}

interface RawTeamsStatsResponse {
  stats?: Array<{
    splits?: RawTeamStatSplit[]
  }>
}

/**
 * Fetches live league R/PA for the season by summing all 30 team hitting splits.
 * Used as the lgR/PA denominator in the park-adjusted wRC+ formula.
 * Falls back to the FanGraphs constant (0.118) on error.
 */
export async function fetchLeagueContext(season: number): Promise<LeagueContext> {
  try {
    const data = await mlbApi.get<RawTeamsStatsResponse>('/teams/stats', {
      group:    'hitting',
      season,
      sportIds: 1,
      gameType: 'R',
      stats:    'season',
      fields:   'stats,splits,stat,runs,plateAppearances',
    })

    let totalRuns = 0
    let totalPA   = 0

    for (const statGroup of data.stats ?? []) {
      for (const split of statGroup.splits ?? []) {
        totalRuns += split.stat?.runs             ?? 0
        totalPA   += split.stat?.plateAppearances ?? 0
      }
    }

    if (totalPA > 0) {
      return { lgRpa: totalRuns / totalPA }
    }
  } catch {
    // fall through to constant
  }

  return { lgRpa: 0.118 }  // FanGraphs 2025/2026 constant fallback
}

import { mlbApi } from '../client'
import { loadLiveConstants, computeWoba, computeWrcPlus, type RawBattingStat } from '../wrcConstants'
import { getParkInfo } from './parkFactors'

export interface TeamOffenseStat {
  teamId:  number
  wrcPlus: number | null
  pa:      number
  woba:    number | null
}

interface RawSplit {
  team?: { id?: number }
  stat?: {
    runs?: number; plateAppearances?: number; atBats?: number; hits?: number
    doubles?: number; triples?: number; homeRuns?: number
    baseOnBalls?: number; intentionalWalks?: number; hitByPitch?: number; sacFlies?: number
  }
}

/**
 * Fetches full-season hitting totals for all 30 MLB teams in one request and
 * returns park-adjusted wRC+ per team. No lineup or boxscore dependency.
 */
export async function fetchTeamOffense(
  season = new Date().getFullYear(),
): Promise<Map<number, TeamOffenseStat>> {
  await loadLiveConstants(season)

  const data = await mlbApi.get<{ stats?: Array<{ splits?: RawSplit[] }> }>('/teams/stats', {
    group:    'hitting',
    season,
    sportIds: 1,
    gameType: 'R',
    stats:    'season',
    fields:   [
      'stats', 'splits', 'stat', 'team', 'id',
      'runs', 'plateAppearances', 'atBats', 'hits',
      'doubles', 'triples', 'homeRuns',
      'baseOnBalls', 'intentionalWalks', 'hitByPitch', 'sacFlies',
    ].join(','),
  })

  const splits: RawSplit[] = (data.stats ?? []).flatMap(sg => sg.splits ?? [])

  // League aggregate for lgRPA + lgwOBA computed from the same response
  const lgTot: RawBattingStat & { runs: number } = {
    runs: 0, atBats: 0, hits: 0, doubles: 0, triples: 0, homeRuns: 0,
    baseOnBalls: 0, intentionalWalks: 0, hitByPitch: 0, sacFlies: 0, plateAppearances: 0,
  }
  for (const sp of splits) {
    const s = sp.stat ?? {}
    lgTot.runs             += s.runs             ?? 0
    lgTot.plateAppearances += s.plateAppearances ?? 0
    lgTot.atBats           += s.atBats           ?? 0
    lgTot.hits             += s.hits             ?? 0
    lgTot.doubles          += s.doubles          ?? 0
    lgTot.triples          += s.triples          ?? 0
    lgTot.homeRuns         += s.homeRuns         ?? 0
    lgTot.baseOnBalls      += s.baseOnBalls      ?? 0
    lgTot.intentionalWalks += s.intentionalWalks ?? 0
    lgTot.hitByPitch       += s.hitByPitch       ?? 0
    lgTot.sacFlies         += s.sacFlies         ?? 0
  }

  const lgCtx = lgTot.plateAppearances > 0
    ? { lgRpa: lgTot.runs / lgTot.plateAppearances, lgwOBA: computeWoba(lgTot, season) }
    : undefined

  const result = new Map<number, TeamOffenseStat>()
  for (const sp of splits) {
    const teamId = sp.team?.id
    if (teamId == null) continue
    const s = sp.stat ?? {}
    const raw: RawBattingStat = {
      atBats:           s.atBats           ?? 0,
      hits:             s.hits             ?? 0,
      doubles:          s.doubles          ?? 0,
      triples:          s.triples          ?? 0,
      homeRuns:         s.homeRuns         ?? 0,
      baseOnBalls:      s.baseOnBalls      ?? 0,
      intentionalWalks: s.intentionalWalks ?? 0,
      hitByPitch:       s.hitByPitch       ?? 0,
      sacFlies:         s.sacFlies         ?? 0,
      plateAppearances: s.plateAppearances ?? 0,
    }
    result.set(teamId, {
      teamId,
      wrcPlus: computeWrcPlus(raw, season, getParkInfo(teamId).factor, lgCtx),
      pa:      raw.plateAppearances,
      woba:    raw.atBats > 0 ? computeWoba(raw, season) : null,
    })
  }
  return result
}

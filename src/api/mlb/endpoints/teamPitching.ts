import { mlbApi } from '../client'
import { loadLiveConstants, ipToDecimal, computeFip, computeFipMinus, computeFipPlus, type RawPitchingStat } from '../wrcConstants'
import { getFipParkFactor } from './parkFactors'

export interface TeamPitchingStat {
  teamId:    number
  ip:        number          // decimal innings pitched
  era:       number | null
  fip:       number | null   // raw FIP
  fipMinus:  number | null   // park-adjusted, lower = better
  fipPlus:   number | null   // 200 − fipMinus, higher = better
}

interface RawSplit {
  team?: { id?: number }
  stat?: {
    era?: string
    inningsPitched?: string | number
    homeRuns?: number
    baseOnBalls?: number
    hitByPitch?: number
    strikeOuts?: number
    earnedRuns?: number
  }
}

export async function fetchTeamPitching(
  season = new Date().getFullYear(),
): Promise<Map<number, TeamPitchingStat>> {
  await loadLiveConstants(season)

  const data = await mlbApi.get<{ stats?: Array<{ splits?: RawSplit[] }> }>('/teams/stats', {
    group:    'pitching',
    season,
    sportIds: 1,
    gameType: 'R',
    stats:    'season',
    fields:   [
      'stats', 'splits', 'stat', 'team', 'id',
      'era', 'inningsPitched', 'homeRuns',
      'baseOnBalls', 'hitByPitch', 'strikeOuts', 'earnedRuns',
    ].join(','),
  })

  const splits: RawSplit[] = (data.stats ?? []).flatMap(sg => sg.splits ?? [])
  const result = new Map<number, TeamPitchingStat>()

  for (const sp of splits) {
    const teamId = sp.team?.id
    if (teamId == null) continue
    const s = sp.stat ?? {}
    const ip = ipToDecimal(s.inningsPitched ?? 0)
    if (ip < 1) continue

    const raw: RawPitchingStat = {
      inningsPitched: ip,
      homeRuns:       s.homeRuns   ?? 0,
      baseOnBalls:    s.baseOnBalls ?? 0,
      hitByPitch:     s.hitByPitch ?? 0,
      strikeOuts:     s.strikeOuts ?? 0,
    }

    const parkFactor = getFipParkFactor(teamId)
    const fip        = computeFip(raw, season)
    const fipMinus   = fip != null ? computeFipMinus(fip, season, parkFactor) : null
    const fipPlus    = fipMinus != null ? computeFipPlus(fipMinus) : null
    const era        = s.era != null ? parseFloat(s.era) : null

    result.set(teamId, { teamId, ip, era, fip, fipMinus, fipPlus })
  }

  return result
}

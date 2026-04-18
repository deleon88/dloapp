import { mlbApi } from '../client'

interface TeamStatSplit {
  stat: {
    ops: string
    obp: string
    slg: string
    avg: string
    homeRuns: number
    runs: number
    strikeOuts: number
    baseOnBalls: number
  }
  team: {
    id: number
    name: string
  }
}

interface TeamStatsResponse {
  stats: Array<{
    splits: TeamStatSplit[]
  }>
}

export interface TeamOpsPlus {
  opsPlus: number
  ops: string
  avg: string
  obp: string
  slg: string
}

export async function fetchTeamOpsPlus(season?: number): Promise<Map<number, TeamOpsPlus>> {
  const yr = season ?? new Date().getFullYear()

  const data = await mlbApi.get<TeamStatsResponse>('/teams/stats', {
    group: 'hitting',
    stats: 'season',
    season: yr,
    sportIds: 1,
    gameType: 'R',
    sortStat: 'ops',
    order: 'desc',
    fields: 'stats,splits,team,id,name,stat,ops,obp,slg,avg,homeRuns,runs,strikeOuts,baseOnBalls',
  })

  const splits = data.stats?.[0]?.splits ?? []
  if (!splits.length) return new Map()

  const lgAvgOps = splits.reduce((sum, s) => sum + parseFloat(s.stat.ops), 0) / splits.length

  const map = new Map<number, TeamOpsPlus>()
  for (const s of splits) {
    const teamOps = parseFloat(s.stat.ops)
    map.set(s.team.id, {
      opsPlus: Math.round((teamOps / lgAvgOps) * 100),
      ops: s.stat.ops,
      avg: s.stat.avg,
      obp: s.stat.obp,
      slg: s.stat.slg,
    })
  }

  return map
}

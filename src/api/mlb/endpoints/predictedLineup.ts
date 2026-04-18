import { format, subDays } from 'date-fns'
import { mlbApi } from '../client'
import type { LineupSlot } from './boxscore'
import { getPitchHands } from './people'
import type { DepthChartData } from './teamRoster'

interface RecentGame {
  gamePk: number
  ourSide: 'away' | 'home'
}

interface PredictionBoxscore {
  battingOrder: number[]
  players: Record<string, {
    person: { id: number; fullName: string }
    position: { abbreviation: string }
    seasonStats: { batting: { avg?: string; obp?: string; plateAppearances?: number } }
    jerseyNumber?: string
  }>
  opposingStarterId: number | null
}

async function getRecentCompletedGames(teamId: number): Promise<RecentGame[]> {
  const season = new Date().getFullYear()
  const today = new Date()
  const endDate = format(subDays(today, 1), 'yyyy-MM-dd')
  const startDate = format(subDays(today, 21), 'yyyy-MM-dd')

  const data = await mlbApi.get<{
    dates: Array<{
      games: Array<{
        gamePk: number
        status: { abstractGameState: string }
        teams: { away: { team: { id: number } }; home: { team: { id: number } } }
      }>
    }>
  }>('/schedule', {
    teamId,
    sportId: 1,
    gameType: 'R',
    season,
    startDate,
    endDate,
    fields: 'dates,games,gamePk,status,abstractGameState,teams,away,home,team,id',
  })

  const result: RecentGame[] = []
  const dates = data.dates ?? []
  for (let d = dates.length - 1; d >= 0; d--) {
    for (const g of [...dates[d].games].reverse()) {
      if (g.status.abstractGameState === 'Final') {
        result.push({
          gamePk: g.gamePk,
          ourSide: g.teams.away.team.id === teamId ? 'away' : 'home',
        })
      }
    }
  }
  return result
}

async function getPredictionBoxscore(
  gamePk: number,
  ourSide: 'away' | 'home',
): Promise<PredictionBoxscore | null> {
  try {
    const oppSide = ourSide === 'away' ? 'home' : 'away'
    const data = await mlbApi.get<{
      teams: Record<string, {
        battingOrder: number[]
        pitchers: number[]
        players: Record<string, PredictionBoxscore['players'][string]>
      }>
    }>(`/game/${gamePk}/boxscore`, {
      fields: [
        'teams', 'away', 'home',
        'battingOrder', 'pitchers',
        'players', 'person', 'id', 'fullName',
        'position', 'abbreviation',
        'seasonStats', 'batting', 'avg', 'obp', 'plateAppearances',
        'jerseyNumber',
      ].join(','),
    })
    return {
      battingOrder: data.teams[ourSide]?.battingOrder ?? [],
      players:      data.teams[ourSide]?.players      ?? {},
      opposingStarterId: data.teams[oppSide]?.pitchers?.[0] ?? null,
    }
  } catch {
    return null
  }
}

interface RecentStats {
  avg: string
  obp: string
  pa: number
}

/** Collects season stats keyed by player ID from recent boxscores. First occurrence = freshest. */
function buildStatsPool(
  results: Array<{ bs: PredictionBoxscore | null }>,
  limit = 10,
): Map<number, RecentStats> {
  const pool = new Map<number, RecentStats>()
  for (const { bs } of results.slice(0, limit)) {
    if (!bs) continue
    for (const [key, p] of Object.entries(bs.players)) {
      const id = Number(key.replace('ID', ''))
      if (pool.has(id)) continue
      const b = p.seasonStats?.batting ?? {}
      pool.set(id, {
        avg: b.avg ?? '.---',
        obp: b.obp ?? '.---',
        pa: b.plateAppearances ?? 0,
      })
    }
  }
  return pool
}

/**
 * Returns a predicted batting order for `teamId` based on their most recent
 * game against a starter who throws with `opposingPitcherHand`. IL players
 * are replaced with the first active depth-chart player at the same position.
 *
 * Fallback chain:
 *  1. Most recent game vs same-hand pitcher
 *  2. Most common batting order across last 5 games
 */
export async function fetchPredictedLineup(
  teamId: number,
  opposingPitcherHand: string,
  depthData: DepthChartData,
): Promise<LineupSlot[] | null> {
  const recentGames = await getRecentCompletedGames(teamId)
  if (!recentGames.length) return null

  const results = await Promise.all(
    recentGames.slice(0, 10).map(async g => ({
      ...g,
      bs: await getPredictionBoxscore(g.gamePk, g.ourSide),
    }))
  )

  const starterIds = [
    ...new Set(
      results.map(r => r.bs?.opposingStarterId).filter((id): id is number => id != null)
    ),
  ]
  const handMap = await getPitchHands(starterIds)

  const match = results.find(r => {
    const id = r.bs?.opposingStarterId
    return id != null && handMap.get(id) === opposingPitcherHand
  })

  const source = match?.bs ?? fallbackBoxscore(results.slice(0, 5))
  if (!source?.battingOrder.length) return null

  const statsPool = buildStatsPool(results)

  return buildLineupFromBoxscore(source, depthData, statsPool)
}

/** Most common batting order across recent games; ties broken by recency. */
function fallbackBoxscore(
  results: Array<{ bs: PredictionBoxscore | null }>,
): PredictionBoxscore | null {
  const valid = results.filter((r): r is typeof r & { bs: PredictionBoxscore } =>
    !!(r.bs?.battingOrder.length)
  )
  if (!valid.length) return null

  const freq = new Map<string, { bs: PredictionBoxscore; count: number }>()
  for (const { bs } of valid) {
    const key = bs.battingOrder.join(',')
    const entry = freq.get(key)
    if (entry) entry.count++
    else freq.set(key, { bs, count: 1 })
  }

  return [...freq.values()].reduce((best, cur) => cur.count > best.count ? cur : best).bs
}

function buildLineupFromBoxscore(
  bs: PredictionBoxscore,
  { ilSet, depthByPosition }: DepthChartData,
  statsPool: Map<number, RecentStats>,
): LineupSlot[] | null {
  const usedIds = new Set<number>()
  const lineup: LineupSlot[] = []

  for (const id of bs.battingOrder) {
    const p = bs.players[`ID${id}`]

    if (ilSet.has(id)) {
      // Find the position this slot normally plays, then pick the first active depth-chart player
      const posAbbr = p?.position.abbreviation ?? 'DH'
      const depthList = depthByPosition.get(posAbbr) ?? depthByPosition.get('DH') ?? []
      const replacement = depthList.find(d => !ilSet.has(d.id) && !usedIds.has(d.id))
      if (replacement) {
        usedIds.add(replacement.id)
        const stats = statsPool.get(replacement.id)
        lineup.push({
          id: replacement.id,
          fullName: replacement.fullName,
          pos: replacement.posAbbr,
          avg: stats?.avg ?? '.---',
          obp: stats?.obp ?? '.---',
          pa: stats?.pa ?? null,
          jerseyNumber: replacement.jerseyNumber,
        })
      }
      continue
    }

    if (!p) continue
    usedIds.add(id)
    const b = p.seasonStats?.batting ?? {}
    lineup.push({
      id,
      fullName: p.person.fullName,
      pos: p.position.abbreviation,
      avg: b.avg ?? '.---',
      obp: b.obp ?? '.---',
      pa: b.plateAppearances ?? null,
      jerseyNumber: p.jerseyNumber ?? '',
    })
  }

  return lineup.length > 0 ? lineup : null
}

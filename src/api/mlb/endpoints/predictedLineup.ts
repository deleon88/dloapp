import { format, subDays } from 'date-fns'
import { mlbApi } from '../client'
import type { LineupSlot } from './boxscore'
import { getPitchHands } from './people'
import type { DepthChartData } from './teamRoster'

// ── Public types ────────────────────────────────────────────────────────────────

export interface PlayerPrediction extends LineupSlot {
  battingSpot: number   // 1-based
  confidence: number    // 0-100; how consistently they bat here vs this hand
  recentStarts: number  // starts across all recent games (~21 days)
  status: 'active' | 'returning'  // 'returning' = few recent starts, likely just back
}

export interface TeamPredictions {
  vsRHP: PlayerPrediction[] | null
  vsLHP: PlayerPrediction[] | null
  generatedAt: number  // Date.now()
}

// ── Internal types ───────────────────────────────────────────────────────────────

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

type GameResult = RecentGame & { bs: PredictionBoxscore | null }

interface RecentStats {
  avg: string
  obp: string
  pa: number
}

// ── Fetchers (same logic, unchanged) ────────────────────────────────────────────

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

/** Season stats keyed by player ID from recent boxscores; first occurrence = freshest. */
function buildStatsPool(
  results: GameResult[],
  limit = 10,
): Map<number, RecentStats> {
  const pool = new Map<number, RecentStats>()
  for (const { bs } of results.slice(0, limit)) {
    if (!bs) continue
    for (const [key, p] of Object.entries(bs.players)) {
      const id = Number(key.replace('ID', ''))
      if (pool.has(id)) continue
      const b = p.seasonStats?.batting ?? {}
      pool.set(id, { avg: b.avg ?? '.---', obp: b.obp ?? '.---', pa: b.plateAppearances ?? 0 })
    }
  }
  return pool
}

// ── Prediction builder ───────────────────────────────────────────────────────────

/**
 * Builds a predicted lineup using frequency analysis across recent games that
 * had an opposing pitcher of the given `hand`.
 *
 * Falls back to all recent games when fewer than 2 hand-specific games exist.
 * IL players are replaced with the top active depth-chart player at their position.
 */
function buildLineupForHand(
  results: GameResult[],
  handMap: Map<number, string>,
  hand: 'R' | 'L',
  depthData: DepthChartData,
  statsPool: Map<number, RecentStats>,
): PlayerPrediction[] | null {
  const { ilSet, depthByPosition } = depthData

  const matching = results.filter(r => {
    const id = r.bs?.opposingStarterId
    return id != null && handMap.get(id) === hand
  })

  // Use hand-specific games if we have enough; otherwise fall back to all recent games
  const source = matching.length >= 2 ? matching : results

  // bySpot[0..8] = Map<playerId, count>
  const bySpot: Array<Map<number, number>> = Array.from({ length: 9 }, () => new Map())
  for (const { bs } of source) {
    if (!bs?.battingOrder.length) continue
    for (let i = 0; i < Math.min(9, bs.battingOrder.length); i++) {
      const pid = bs.battingOrder[i]
      bySpot[i].set(pid, (bySpot[i].get(pid) ?? 0) + 1)
    }
  }

  const gamesUsed = source.filter(r => r.bs?.battingOrder.length).length
  if (gamesUsed === 0) return null

  // Consolidate all player data across all results for name/position lookup
  const playerData = new Map<number, PredictionBoxscore['players'][string]>()
  for (const { bs } of results) {
    if (!bs) continue
    for (const [key, p] of Object.entries(bs.players)) {
      const id = Number(key.replace('ID', ''))
      if (!playerData.has(id)) playerData.set(id, p)
    }
  }

  const usedIds = new Set<number>()
  const lineup: PlayerPrediction[] = []

  for (let spot = 0; spot < 9; spot++) {
    const freqMap = bySpot[spot]

    // Most frequent non-IL, non-duplicate player in this spot
    const candidates = [...freqMap.entries()].sort((a, b) => b[1] - a[1])
    let chosen: { id: number; count: number } | null = null
    for (const [id, count] of candidates) {
      if (!usedIds.has(id) && !ilSet.has(id)) { chosen = { id, count }; break }
    }

    if (chosen) {
      const p = playerData.get(chosen.id)
      if (!p) continue

      usedIds.add(chosen.id)
      const stats = statsPool.get(chosen.id)
      const confidence = Math.min(100, Math.round((chosen.count / gamesUsed) * 100))
      const recentStarts = results.filter(r => r.bs?.battingOrder.includes(chosen!.id)).length

      lineup.push({
        id: chosen.id,
        fullName: p.person.fullName,
        pos: p.position.abbreviation,
        avg: stats?.avg ?? p.seasonStats.batting.avg ?? '.---',
        obp: stats?.obp ?? p.seasonStats.batting.obp ?? '.---',
        pa: stats?.pa ?? p.seasonStats.batting.plateAppearances ?? null,
        jerseyNumber: p.jerseyNumber ?? '',
        battingSpot: spot + 1,
        confidence,
        recentStarts,
        status: recentStarts < 3 ? 'returning' : 'active',
      })
    } else {
      // IL replacement: find the most common position for this batting spot,
      // then use the first available active depth-chart player
      let posAbbr = 'DH'
      for (const [id] of candidates) {
        const p = playerData.get(id)
        if (p) { posAbbr = p.position.abbreviation; break }
      }

      const depthList = depthByPosition.get(posAbbr) ?? depthByPosition.get('DH') ?? []
      const replacement = depthList.find(d => !ilSet.has(d.id) && !usedIds.has(d.id))
      if (!replacement) continue

      usedIds.add(replacement.id)
      const stats = statsPool.get(replacement.id)
      const recentStarts = results.filter(r => r.bs?.battingOrder.includes(replacement.id)).length

      lineup.push({
        id: replacement.id,
        fullName: replacement.fullName,
        pos: replacement.posAbbr,
        avg: stats?.avg ?? '.---',
        obp: stats?.obp ?? '.---',
        pa: stats?.pa ?? null,
        jerseyNumber: replacement.jerseyNumber,
        battingSpot: spot + 1,
        confidence: recentStarts >= 3 ? 50 : 35,
        recentStarts,
        status: 'returning',
      })
    }
  }

  return lineup.length > 0 ? lineup : null
}

// ── Public API ───────────────────────────────────────────────────────────────────

/**
 * Fetches and returns predicted lineups for both vsRHP and vsLHP in a single
 * shot, reusing the same recent-game data for both predictions.
 *
 * Results are computed fresh each call; cache them at the call site.
 */
export async function fetchTeamPredictions(
  teamId: number,
  depthData: DepthChartData,
): Promise<TeamPredictions> {
  const empty: TeamPredictions = { vsRHP: null, vsLHP: null, generatedAt: Date.now() }

  const recentGames = await getRecentCompletedGames(teamId)
  if (!recentGames.length) return empty

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
  const statsPool = buildStatsPool(results)

  return {
    vsRHP: buildLineupForHand(results, handMap, 'R', depthData, statsPool),
    vsLHP: buildLineupForHand(results, handMap, 'L', depthData, statsPool),
    generatedAt: Date.now(),
  }
}

/**
 * Single-hand convenience wrapper used by legacy call sites.
 * Defaults to vsRHP when `opposingPitcherHand` is unknown or absent.
 */
export async function fetchPredictedLineup(
  teamId: number,
  opposingPitcherHand: string | undefined,
  depthData: DepthChartData,
): Promise<LineupSlot[] | null> {
  const preds = await fetchTeamPredictions(teamId, depthData)
  const hand = opposingPitcherHand === 'L' ? preds.vsLHP : preds.vsRHP
  return hand ?? preds.vsRHP ?? null
}

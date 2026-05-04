import { format, subDays } from 'date-fns'
import { mlbApi } from '../client'
import type { LineupSlot } from './boxscore'
import { getPitchHands } from './people'
import { fetchDepthChart, type DepthChartData } from './teamRoster'
import { getGoToLineup, setGoToLineup, goToIdSet } from './goToLineupStore'

// ── Public types ─────────────────────────────────────────────────────────────

export interface PlayerPrediction extends LineupSlot {
  battingSpot: number
  confidence: number    // 0-100; frequency of appearing in this spot vs this hand
  recentStarts: number  // total starts in the ~21-day window
  status: 'active' | 'returning'
}

export interface TeamPredictions {
  vsRHP: PlayerPrediction[] | null
  vsLHP: PlayerPrediction[] | null
  generatedAt: number
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RecentGame {
  gamePk: number
  ourSide: 'away' | 'home'
}

interface PredictionBoxscore {
  battingOrder: number[]
  players: Record<string, {
    person: { id: number; fullName: string }
    position: { abbreviation: string }
    stats?: { fielding?: { innings?: string } }
    seasonStats: { batting: { avg?: string; obp?: string; plateAppearances?: number } }
    jerseyNumber?: string
  }>
  opposingStarterId: number | null
}

type GameResult  = RecentGame & { bs: PredictionBoxscore | null }
type PlayerEntry = PredictionBoxscore['players'][string]

interface RecentStats { avg: string; obp: string; pa: number }

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function getRecentCompletedGames(teamId: number): Promise<RecentGame[]> {
  const season = new Date().getFullYear()
  const today = new Date()
  const endDate   = format(subDays(today, 1),  'yyyy-MM-dd')
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
    teamId, sportId: 1, gameType: 'R', season, startDate, endDate,
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
        players: Record<string, PlayerEntry>
      }>
    }>(`/game/${gamePk}/boxscore`, {
      fields: [
        'teams', 'away', 'home',
        'battingOrder', 'pitchers',
        'players', 'person', 'id', 'fullName',
        'position', 'abbreviation',
        'stats', 'fielding', 'innings',
        'seasonStats', 'batting', 'avg', 'obp', 'plateAppearances',
        'jerseyNumber',
      ].join(','),
    })
    return {
      battingOrder:      data.teams[ourSide]?.battingOrder ?? [],
      players:           data.teams[ourSide]?.players      ?? {},
      opposingStarterId: data.teams[oppSide]?.pitchers?.[0] ?? null,
    }
  } catch {
    return null
  }
}

function buildStatsPool(results: GameResult[], limit = 10): Map<number, RecentStats> {
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

// ── Frequency maps ────────────────────────────────────────────────────────────

const NON_STARTER_POS = new Set(['P', 'PH', 'PR'])

const REQUIRED_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const

interface SpotMaps {
  freq:    Array<Map<number, number>>  // bySpot[spot] → playerId → appearances
  spotPos: Array<Map<number, string>>  // bySpot[spot] → playerId → position THEY PLAYED at that spot
}

/**
 * Builds per-spot frequency and per-spot position maps from a game list,
 * excluding PH/PR entries.
 *
 * `spotPos` uses the MOST FREQUENT position each player played at each spot
 * (not most-recent). This matters for platoon players who switch positions
 * between starts (e.g. Steer as RF vs RHP but 1B vs LHP in one game).
 * When two positions are equally frequent, `refMaps` (typically the all-games
 * map) breaks the tie — preventing small samples from producing misleading
 * position assignments.
 */
function buildSpotMaps(games: GameResult[], refMaps?: SpotMaps): SpotMaps {
  const freq:       Array<Map<number, number>>              = Array.from({ length: 9 }, () => new Map())
  const posInnings: Array<Map<number, Map<string, number>>> = Array.from({ length: 9 }, () => new Map())

  for (const { bs } of games) {
    if (!bs?.battingOrder.length) continue
    for (let i = 0; i < Math.min(9, bs.battingOrder.length); i++) {
      const pid    = bs.battingOrder[i]
      const entry  = bs.players[`ID${pid}`]
      const pos    = entry?.position.abbreviation ?? ''
      if (NON_STARTER_POS.has(pos)) continue

      freq[i].set(pid, (freq[i].get(pid) ?? 0) + 1)

      // Weight by innings played at this defensive position so a player who
      // spent 9 innings at RF beats one who played 2 innings at 1B that game.
      // DH entries have no fielding innings — default to 9 so they're counted fully.
      const inn = parseFloat(entry?.stats?.fielding?.innings ?? '') || 9
      const pm  = posInnings[i].get(pid) ?? new Map<string, number>()
      pm.set(pos, (pm.get(pos) ?? 0) + inn)
      posInnings[i].set(pid, pm)
    }
  }

  // spotPos: position with most cumulative innings; ties broken by refMaps (allMaps)
  const spotPos: Array<Map<number, string>> = Array.from({ length: 9 }, () => new Map())
  for (let i = 0; i < 9; i++) {
    for (const [pid, pm] of posInnings[i]) {
      const sorted = [...pm.entries()].sort((a, b) => b[1] - a[1])
      let best = sorted[0][0]
      if (sorted.length > 1 && sorted[0][1] === sorted[1][1] && refMaps) {
        const refPos = refMaps.spotPos[i]?.get(pid)
        if (refPos && pm.has(refPos)) best = refPos
      }
      spotPos[i].set(pid, best)
    }
  }

  return { freq, spotPos }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Finds the best available player for batting `spot`.
 *
 * Position resolution order for each candidate:
 *   1. Freq-mapped position at this spot (innings-weighted from recent games)
 *   2. Depth-chart position — preferred over freq-mapped when the two differ
 *      AND the depth-chart position is still open.  This prevents a player
 *      who "borrowed" a position in recent games (e.g. SS playing 3B while
 *      the regular 3B was out) from permanently blocking their natural slot.
 *
 * Search order: hand-filtered maps → all-games maps.
 */
function resolveStarter(
  spot: number,
  hand: SpotMaps,
  all: SpotMaps,
  playerData: Map<number, PlayerEntry>,
  ilSet: Set<number>,
  usedIds: Set<number>,
  usedPositions: Set<string>,
  goToIds: Set<number>,
  depthPosMap: Map<number, string>,
): { id: number; p: PlayerEntry; pos: string } | null {
  for (const maps of [hand, all]) {
    const freqMap = maps.freq[spot]
    if (!freqMap?.size) continue
    // Primary sort: descending frequency. Tiebreaker: go-to lineup wins.
    const sorted = [...freqMap.entries()].sort((a, b) => {
      const diff = b[1] - a[1]
      if (diff !== 0) return diff
      return (goToIds.has(b[0]) ? 1 : 0) - (goToIds.has(a[0]) ? 1 : 0)
    })
    for (const [cid] of sorted) {
      if (usedIds.has(cid) || ilSet.has(cid)) continue
      const cp = playerData.get(cid)
      if (!cp) continue
      const freqPos = maps.spotPos[spot]?.get(cid) ?? all.spotPos[spot]?.get(cid) ?? cp.position.abbreviation
      const dcPos   = depthPosMap.get(cid)
      // Prefer depth-chart position when freq data differs — keeps players at their
      // natural slot so their actual position doesn't block another required spot.
      const cpos = (dcPos && dcPos !== freqPos && !usedPositions.has(dcPos)) ? dcPos : freqPos
      if (!usedPositions.has(cpos)) {
        return { id: cid, p: cp, pos: cpos }
      }
    }
  }
  return null
}

/** Most common defensive position seen at `spot` — used to drive depth-chart fallback. */
function expectedPosition(spot: number, all: SpotMaps): string {
  const freqMap = all.freq[spot]
  if (!freqMap?.size) return 'DH'
  const posFreq = new Map<string, number>()
  for (const [pid, count] of freqMap) {
    const pos = all.spotPos[spot]?.get(pid) ?? ''
    if (pos && !NON_STARTER_POS.has(pos)) posFreq.set(pos, (posFreq.get(pos) ?? 0) + count)
  }
  if (!posFreq.size) return 'DH'
  return [...posFreq.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Builds a predicted lineup for one pitcher hand using per-spot frequency.
 *
 * Platoon splits (Kim at SS vs RHP, Rojas at SS vs LHP) surface naturally
 * because each hand-specific bySpot independently tallies who appeared there.
 *
 * Position uniqueness is enforced using each player's SPOT-SPECIFIC position
 * (not their global position), so Rojas batting 9th as 2B never conflicts
 * with Kim batting 8th as SS even though both are listed as SS globally.
 *
 * Depth-chart fallback covers the case where the frequency maps have no
 * usable candidate (starter just got injured, no backup history at that slot).
 */
function buildLineupForHand(
  results: GameResult[],
  handMap: Map<number, string>,
  hand: 'R' | 'L',
  depthData: DepthChartData,
  statsPool: Map<number, RecentStats>,
  goToLineup: PlayerPrediction[] | null | undefined,
): PlayerPrediction[] | null {
  const { ilSet, depthByPosition } = depthData

  const matching = results.filter(r => {
    const id = r.bs?.opposingStarterId
    return id != null && handMap.get(id) === hand
  })
  const source = matching.length >= 2 ? matching : results
  const valid  = source.filter(r => (r.bs?.battingOrder.length ?? 0) > 0)
  if (!valid.length) return null

  const allMaps  = buildSpotMaps(results.filter(r => (r.bs?.battingOrder.length ?? 0) > 0))
  const handMaps = buildSpotMaps(valid, allMaps)  // allMaps breaks position ties in small samples
  const totalGames = valid.length

  // Consolidated player data for name/stats fallback
  const playerData = new Map<number, PlayerEntry>()
  for (const { bs } of results) {
    if (!bs) continue
    for (const [key, p] of Object.entries(bs.players)) {
      const id = Number(key.replace('ID', ''))
      if (!playerData.has(id)) playerData.set(id, p)
    }
  }

  // Player ID → their scarcest depth-chart position (fewest active alternatives).
  // A player listed at both SS (1 active) and 3B (4 active) maps to SS so they
  // don't accidentally block the only coverage for that slot.
  const activePerPos = new Map<string, number>()
  for (const [pos, players] of depthByPosition) activePerPos.set(pos, players.length)
  const depthPosMap = new Map<number, string>()
  for (const [pos, players] of depthByPosition) {
    for (const dp of players) {
      const cur = depthPosMap.get(dp.id)
      if (!cur || (activePerPos.get(pos) ?? Infinity) < (activePerPos.get(cur) ?? Infinity)) {
        depthPosMap.set(dp.id, pos)
      }
    }
  }

  const usedIds       = new Set<number>()
  const usedPositions = new Set<string>()
  const slots: (PlayerPrediction | null)[] = Array(9).fill(null)
  const goToIds       = goToIdSet(goToLineup)

  // ── Pass 1: frequency maps + depth fallback per spot ─────────────
  for (let spot = 0; spot < 9; spot++) {
    const resolved = resolveStarter(spot, handMaps, allMaps, playerData, ilSet, usedIds, usedPositions, goToIds, depthPosMap)

    if (resolved) {
      const { id, p, pos } = resolved
      usedIds.add(id)
      usedPositions.add(pos)

      const spotCount    = handMaps.freq[spot]?.get(id) ?? 0
      const confidence   = Math.min(100, Math.round((spotCount / totalGames) * 100))
      const recentStarts = results.filter(r => r.bs?.battingOrder.includes(id)).length
      const stats        = statsPool.get(id)

      slots[spot] = {
        id,
        fullName:     p.person.fullName,
        pos,
        avg:          stats?.avg ?? p.seasonStats.batting.avg ?? '.---',
        obp:          stats?.obp ?? p.seasonStats.batting.obp ?? '.---',
        pa:           stats?.pa  ?? p.seasonStats.batting.plateAppearances ?? null,
        jerseyNumber: p.jerseyNumber ?? '',
        battingSpot:  spot + 1,
        confidence,
        recentStarts,
        status:       recentStarts < 3 ? 'returning' : 'active',
      }
    } else {
      // Frequency maps exhausted — try expected position first, then every
      // unfilled required position in order until one has an available player.
      const primary  = expectedPosition(spot, allMaps)
      const toTry    = [primary, ...REQUIRED_POSITIONS.filter(p => p !== primary && !usedPositions.has(p))]
      let repl: import('./teamRoster').DepthPlayer | undefined
      let replPos    = ''
      for (const tryPos of toTry) {
        if (usedPositions.has(tryPos)) continue
        repl = (depthByPosition.get(tryPos) ?? []).find(d => !ilSet.has(d.id) && !usedIds.has(d.id))
        if (repl) { replPos = tryPos; break }
      }
      if (!repl) continue  // slot stays null; pass 2 may fill it

      usedIds.add(repl.id)
      usedPositions.add(replPos)
      const stats     = statsPool.get(repl.id)
      const repStarts = results.filter(r => r.bs?.battingOrder.includes(repl!.id)).length

      slots[spot] = {
        id:           repl.id,
        fullName:     repl.fullName,
        pos:          replPos,
        avg:          stats?.avg ?? '.---',
        obp:          stats?.obp ?? '.---',
        pa:           stats?.pa  ?? null,
        jerseyNumber: repl.jerseyNumber,
        battingSpot:  spot + 1,
        confidence:   repStarts >= 3 ? 50 : 35,
        recentStarts: repStarts,
        status:       'returning',
      }
    }
  }

  // ── Pass 2: pair any remaining null slots with still-missing required positions ──
  const filledPos  = new Set(slots.filter(Boolean).map(p => p!.pos))
  const stillNeed  = REQUIRED_POSITIONS.filter(p => !filledPos.has(p))
  let needIdx = 0
  for (let spot = 0; spot < 9 && needIdx < stillNeed.length; spot++) {
    if (slots[spot] !== null) continue
    const pos      = stillNeed[needIdx++]
    const repl     = (depthByPosition.get(pos) ?? []).find(d => !ilSet.has(d.id) && !usedIds.has(d.id))
    if (!repl) continue
    usedIds.add(repl.id)
    usedPositions.add(pos)
    const stats     = statsPool.get(repl.id)
    const repStarts = results.filter(r => r.bs?.battingOrder.includes(repl.id)).length
    slots[spot] = {
      id:           repl.id,
      fullName:     repl.fullName,
      pos,
      avg:          stats?.avg ?? '.---',
      obp:          stats?.obp ?? '.---',
      pa:           stats?.pa  ?? null,
      jerseyNumber: repl.jerseyNumber,
      battingSpot:  spot + 1,
      confidence:   repStarts >= 3 ? 50 : 35,
      recentStarts: repStarts,
      status:       'returning',
    }
  }

  const lineup = slots.filter((p): p is PlayerPrediction => p !== null)
  return lineup.length > 0 ? lineup : null
}

// ── Public API ────────────────────────────────────────────────────────────────

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
  const handMap   = await getPitchHands(starterIds)
  const statsPool = buildStatsPool(results)

  // Load previous go-to lineup as tiebreaker; on first run this is null (pure frequency).
  // After each run we persist the result, so the lineup stabilises over time.
  const prevGoTo = getGoToLineup(teamId)

  const preds: TeamPredictions = {
    vsRHP: buildLineupForHand(results, handMap, 'R', depthData, statsPool, prevGoTo?.vsRHP),
    vsLHP: buildLineupForHand(results, handMap, 'L', depthData, statsPool, prevGoTo?.vsLHP),
    generatedAt: Date.now(),
  }

  setGoToLineup(teamId, preds)
  return preds
}

export async function fetchTeamPredictionsNoDepth(teamId: number): Promise<TeamPredictions> {
  const depthData = await fetchDepthChart(teamId).catch(
    (): DepthChartData => ({ ilSet: new Set(), depthByPosition: new Map() }),
  )
  return fetchTeamPredictions(teamId, depthData)
}

/** Single-hand wrapper; defaults to vsRHP when hand is unknown. */
export async function fetchPredictedLineup(
  teamId: number,
  opposingPitcherHand: string | undefined,
  depthData: DepthChartData,
): Promise<LineupSlot[] | null> {
  const preds = await fetchTeamPredictions(teamId, depthData)
  const hand  = opposingPitcherHand === 'L' ? preds.vsLHP : preds.vsRHP
  return hand ?? preds.vsRHP ?? null
}

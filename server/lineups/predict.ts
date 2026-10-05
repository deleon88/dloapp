// Go-to lineup of a team against a starter's hand (pure, no I/O).
//
// Source: the team's last 5 lineups against that hand. Each batting spot goes
// to whoever started there most often in that sample; then the roster is
// checked so injured, optioned or traded players are skipped, and positions
// can't repeat. When the sample has no usable candidate for a spot, the last
// 10 lineups overall are tried, and finally the depth chart.
//
// Same rules the app used to run in the browser (predictedLineup.ts), now with
// a fixed "last 5 vs that hand" window instead of the last 21 days.

export type Hand = 'L' | 'R'

/** One past lineup, spots 1-9 in order. */
export interface PastLineup {
  gamePk: number
  vsHand: Hand | null          // hand of the opposing starter
  slots: Array<{ playerId: number; position: string; innings: number }>
}

export interface DepthPlayer { id: number; fullName: string; jerseyNumber: string }

export interface RosterInfo {
  /** Who can play today (active roster). null = unknown: only `unavailable` is used. */
  active: Set<number> | null
  /** Injured list and other inactive statuses from the depth chart. */
  unavailable: Set<number>
  /** Position → available players in depth order (position players only). */
  depthByPosition: Map<string, DepthPlayer[]>
}

export interface GoToSlot {
  id: number
  pos: string
  battingSpot: number
  confidence: number      // 0-100: share of the sample games where they batted in this spot
  recentStarts: number    // starts in the team's last 10 games
  status: 'active' | 'returning'
}

export interface GoToResult {
  lineup: GoToSlot[] | null
  games: number[]          // gamePks of the sample, newest first
  fallback: boolean        // fewer than 2 games vs this hand: the last 5 overall were used
}

export const SAMPLE_SIZE = 5
const OVERALL_SIZE = 10
const MIN_HAND_GAMES = 2
const NON_STARTER_POS = new Set(['P', 'PH', 'PR'])
const REQUIRED_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const

interface SpotMaps {
  freq: Array<Map<number, number>>      // spot → playerId → starts there
  spotPos: Array<Map<number, string>>   // spot → playerId → position played from that spot
}

/**
 * Per-spot frequency, and the position each player played from each spot:
 * the one with most innings (a platoon player can switch, e.g. RF vs RHP and
 * 1B vs LHP). Ties go to `ref` (the overall sample) so a tiny sample doesn't
 * decide a position by chance.
 */
function buildSpotMaps(games: PastLineup[], ref?: SpotMaps): SpotMaps {
  const freq: SpotMaps['freq'] = Array.from({ length: 9 }, () => new Map())
  const posInnings: Array<Map<number, Map<string, number>>> = Array.from({ length: 9 }, () => new Map())

  for (const g of games) {
    g.slots.slice(0, 9).forEach((s, i) => {
      if (NON_STARTER_POS.has(s.position)) return
      freq[i].set(s.playerId, (freq[i].get(s.playerId) ?? 0) + 1)
      const pm = posInnings[i].get(s.playerId) ?? new Map<string, number>()
      pm.set(s.position, (pm.get(s.position) ?? 0) + s.innings)
      posInnings[i].set(s.playerId, pm)
    })
  }

  const spotPos: SpotMaps['spotPos'] = Array.from({ length: 9 }, () => new Map())
  for (let i = 0; i < 9; i++) {
    for (const [pid, pm] of posInnings[i]) {
      const sorted = [...pm.entries()].sort((a, b) => b[1] - a[1])
      let best = sorted[0][0]
      if (sorted.length > 1 && sorted[0][1] === sorted[1][1] && ref) {
        const refPos = ref.spotPos[i].get(pid)
        if (refPos && pm.has(refPos)) best = refPos
      }
      spotPos[i].set(pid, best)
    }
  }
  return { freq, spotPos }
}

/** Most common position batting from `spot` — where to look in the depth chart. */
function expectedPosition(spot: number, maps: SpotMaps): string {
  const posFreq = new Map<string, number>()
  for (const [pid, count] of maps.freq[spot]) {
    const pos = maps.spotPos[spot].get(pid)
    if (pos) posFreq.set(pos, (posFreq.get(pos) ?? 0) + count)
  }
  return [...posFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'DH'
}

export function buildGoToLineup(
  history: PastLineup[],          // the team's lineups, newest first
  hand: Hand,
  roster: RosterInfo,
  previous: number[] = [],        // player ids of the last go-to: breaks frequency ties, keeps it stable
): GoToResult {
  const played = history.filter(g => g.slots.length > 0)
  const vsHand = played.filter(g => g.vsHand === hand).slice(0, SAMPLE_SIZE)
  const fallback = vsHand.length < MIN_HAND_GAMES
  const sample = fallback ? played.slice(0, SAMPLE_SIZE) : vsHand
  const overall = played.slice(0, OVERALL_SIZE)
  const games = sample.map(g => g.gamePk)
  if (!sample.length) return { lineup: null, games, fallback }

  const allMaps = buildSpotMaps(overall)
  const handMaps = buildSpotMaps(sample, allMaps)
  const prevIds = new Set(previous)

  const isAvailable = (id: number) =>
    !roster.unavailable.has(id) && (roster.active == null || roster.active.has(id))

  // Depth-chart helpers. primaryAt: player → position where they're listed first
  // (a starter there). scarcest: player → their listed position with the fewest
  // available players, so a utility guy doesn't block the only SS.
  const depth = new Map([...roster.depthByPosition].map(([pos, list]) => [pos, list.filter(p => isAvailable(p.id))]))
  const primaryAt = new Map<number, string>()
  for (const [pos, list] of depth) if (list[0] && !primaryAt.has(list[0].id)) primaryAt.set(list[0].id, pos)
  const scarcest = new Map<number, string>()
  for (const [pos, list] of depth) {
    for (const p of list) {
      const cur = scarcest.get(p.id)
      if (!cur || list.length < (depth.get(cur)?.length ?? Infinity)) scarcest.set(p.id, pos)
    }
  }

  // Latest position each player was seen at, for players outside the sample maps.
  const lastPos = new Map<number, string>()
  for (const g of played) for (const s of g.slots) if (!lastPos.has(s.playerId)) lastPos.set(s.playerId, s.position)

  const startsInOverall = (id: number) => overall.filter(g => g.slots.some(s => s.playerId === id)).length

  const usedIds = new Set<number>()
  const usedPos = new Set<string>()
  const slots: Array<GoToSlot | null> = Array(9).fill(null)

  const take = (spot: number, id: number, pos: string, confidence: number, forceReturning = false) => {
    usedIds.add(id)
    usedPos.add(pos)
    const recentStarts = startsInOverall(id)
    slots[spot] = {
      id, pos, battingSpot: spot + 1, confidence, recentStarts,
      status: forceReturning || recentStarts < 3 ? 'returning' : 'active',
    }
  }

  /** Best available player for a spot: hand sample first, then the overall one. */
  function resolve(spot: number): { id: number; pos: string } | null {
    for (const maps of [handMaps, allMaps]) {
      const sorted = [...maps.freq[spot].entries()].sort((a, b) =>
        b[1] - a[1] || Number(prevIds.has(b[0])) - Number(prevIds.has(a[0])))
      for (const [id] of sorted) {
        if (usedIds.has(id) || !isAvailable(id)) continue
        const freqPos = maps.spotPos[spot].get(id) ?? allMaps.spotPos[spot].get(id) ?? lastPos.get(id) ?? ''
        // Send a fill-in back to their natural position when it's still open
        // (a SS who covered 3B while the regular was out) — but never move a
        // player who is the depth-chart starter where they've been playing.
        const dcPos = scarcest.get(id)
        const pos = dcPos && dcPos !== freqPos && !usedPos.has(dcPos) && primaryAt.get(id) !== freqPos ? dcPos : freqPos
        if (pos && !usedPos.has(pos)) return { id, pos }
      }
    }
    return null
  }

  // Pass 1: by frequency, falling back to the depth chart at the expected position.
  for (let spot = 0; spot < 9; spot++) {
    const r = resolve(spot)
    if (r) {
      const count = handMaps.freq[spot].get(r.id) ?? 0
      take(spot, r.id, r.pos, Math.min(100, Math.round((count / sample.length) * 100)))
      continue
    }
    const expected = expectedPosition(spot, allMaps)
    for (const pos of [expected, ...REQUIRED_POSITIONS.filter(p => p !== expected)]) {
      if (usedPos.has(pos)) continue
      const repl = (depth.get(pos) ?? []).find(p => !usedIds.has(p.id))
      if (repl) { take(spot, repl.id, pos, startsInOverall(repl.id) >= 3 ? 50 : 35, true); break }
    }
  }

  // Pass 2: any spot still empty takes a still-missing position from the depth
  // chart. Anyone can DH: if the DH list is used up, the available position
  // player with the most recent starts gets it.
  const missing = REQUIRED_POSITIONS.filter(p => !usedPos.has(p))
  const anyHitter = () => [...new Set([...depth.values()].flat())]
    .filter(p => !usedIds.has(p.id))
    .sort((a, b) => startsInOverall(b.id) - startsInOverall(a.id))[0]
  for (let spot = 0, m = 0; spot < 9 && m < missing.length; spot++) {
    if (slots[spot]) continue
    const pos = missing[m++]
    const repl = (depth.get(pos) ?? []).find(p => !usedIds.has(p.id)) ?? (pos === 'DH' ? anyHitter() : undefined)
    if (repl) take(spot, repl.id, pos, startsInOverall(repl.id) >= 3 ? 50 : 35, true)
  }

  const lineup = slots.filter((s): s is GoToSlot => s != null)
  return { lineup: lineup.length ? lineup : null, games, fallback }
}

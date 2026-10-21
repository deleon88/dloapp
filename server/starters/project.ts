// Projected starting pitcher for a game with no announced probable (pure: no
// database, see projectStarters in service.ts for the data and tests in
// tests/unit/starters.test.ts).
//
// The rotation is the team's last distinct real starters (35+ pitches), minus
// arms that haven't started in STALE_DAYS (hurt or sent down). In the regular
// season it's the turn — whoever started CYCLE_BACK games ago, if rested — and
// otherwise the member with the longest rest. In the postseason, with off days,
// teams line their best arms up again: among those rested, the order the team
// used them in its latest playoff series (Rasmussen → Peralta → Jax → Martinez),
// or the lowest FIP before it has one.
//
// Backtest (npm run db:validate-starters), next game, top-1 / top-3: 2025
// regular 70.9% / 77.7% (78.0% reachable: the real starter was in the rotation
// at all), postseason 55.3% / 83.0%; 2026 regular 69.1% / 75.4% (76.1%),
// postseason 51.4% / 65.7%. A fixed five-man rotation: 67.7% / 66.3%.

export interface Start {
  date: string        // YYYY-MM-DD
  pitcherId: number
  pitches: number
  /** A postseason game (its order says how the team ranks its starters). */
  post?: boolean
  /** The turn was an opener's: who opened ahead of this (bulk) pitcher. */
  opener?: number
}

/** A start as the game's starter recorded it, with the longest reliever behind it. */
export interface GameStart extends Start {
  bulkId?: number | null
  bulkPitches?: number | null
}

/**
 * The rotation turn of a start: a short opening (under REAL_START pitches) with
 * a long reliever behind it is that reliever's turn, the opener attached
 * (Drohan opens, May pitches the bulk: May's turn).
 */
export function asTurn(s: GameStart): Start {
  const { bulkId, bulkPitches, ...start } = s
  if (s.pitches < REAL_START && bulkId && (bulkPitches ?? 0) >= REAL_START) {
    return { ...start, pitcherId: bulkId, pitches: bulkPitches!, opener: s.pitcherId }
  }
  return start
}

export interface ProjectOptions {
  postseason: boolean
  /** FIP (lower = better) by pitcher, to rank rested arms in the postseason. */
  quality?: Map<number, number>
  /** Not available (injured list, announced elsewhere…). */
  unavailable?: Set<number>
  /** Tuning (backtests): rotation size, days without a start that drop an arm, postseason ranking
   * ('order' = the team's latest series order then FIP, the default; 'fip'; 'rest'). */
  rotationSize?: number
  staleDays?: number
  postseasonRank?: 'order' | 'fip' | 'rest'
  /** Regular season: the starter of this many team games ago, when rested (the turn). */
  cycleBack?: number
}

const REAL_START = 35           // pitches: shorter outings (openers, early exits) don't define the rotation
const ROTATION_SIZE = 5
const REST_FULL = 5             // days between starts for a normal turn (4 days of rest)
const REST_MIN = 4              // short rest, only if nobody has a full one
/** Days without a start after which an arm no longer counts as in the rotation. */
export const STALE_DAYS = 12
/** A five-man turn: the starter of five team games ago comes up again. */
export const CYCLE_BACK = 5
/** Postseason: this many days without a start means a new series (the order restarts at #1). */
const NEW_SERIES_GAP = 3

/**
 * How the team ranks its starters in the postseason: the order its real
 * starters first took the ball in its latest playoff series (a run of games
 * with no NEW_SERIES_GAP-day break) that used at least three of them. Empty
 * before such a series exists.
 */
export function seriesOrder(starts: Start[]): number[] {
  const post = starts.filter(s => s.post && s.pitches >= REAL_START)
  let end = post.length
  while (end > 0) {
    let i = end - 1
    while (i > 0 && daysBetween(post[i - 1].date, post[i].date) < NEW_SERIES_GAP) i--
    const order: number[] = []
    for (const s of post.slice(i, end)) if (!order.includes(s.pitcherId)) order.push(s.pitcherId)
    if (order.length >= 3) return order
    end = i
  }
  return []
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** The rotation: the last distinct real starters, most recent first. */
export function rotation(starts: Start[], size = ROTATION_SIZE): number[] {
  const out: number[] = []
  for (let i = starts.length - 1; i >= 0 && out.length < size; i--) {
    const s = starts[i]
    if (s.pitches >= REAL_START && !out.includes(s.pitcherId)) out.push(s.pitcherId)
  }
  return out
}

/**
 * Candidates to start on `date`, most likely first, from the team's starts
 * before it (oldest first): the turn, then the rested rotation (by rest in the
 * regular season, by FIP in the postseason), then arms on short rest. Empty
 * when there's no history.
 */
export function rankStarters(starts: Start[], date: string, opts: ProjectOptions): number[] {
  const before = starts.filter(s => s.date < date)
  const last = new Map<number, string>()
  for (const s of before) last.set(s.pitcherId, s.date)   // any start counts for rest
  const rest = (id: number) => daysBetween(last.get(id)!, date)
  let members = rotation(before, opts.rotationSize).filter(id => !opts.unavailable?.has(id))
  // An arm that hasn't started in a long while is hurt or out of the rotation
  if (opts.staleDays) {
    const fresh = members.filter(id => rest(id) <= opts.staleDays!)
    if (fresh.length) members = fresh
  }

  const fip = (id: number) => opts.quality?.get(id) ?? Infinity
  // Postseason: the team's own order from its latest series, then FIP
  const rank = opts.postseasonRank ?? 'order'
  const seq = opts.postseason && rank === 'order' ? seriesOrder(before) : []
  const place = (id: number) => (seq.includes(id) ? seq.indexOf(id) : seq.length)
  const order = (a: number, b: number) => opts.postseason && rank !== 'rest'
    ? place(a) - place(b) || fip(a) - fip(b) || rest(b) - rest(a)
    : rest(b) - rest(a) || fip(a) - fip(b)
  const full = members.filter(id => rest(id) >= REST_FULL).sort(order)
  const short = members.filter(id => rest(id) >= REST_MIN && rest(id) < REST_FULL).sort(order)
  let ranked = [...full, ...short]


  // The turn: whoever started N games ago comes up again, if rested and still around
  if (!opts.postseason && opts.cycleBack) {
    const turn = before[before.length - opts.cycleBack]?.pitcherId
    if (turn != null && ranked.includes(turn)) ranked = [turn, ...ranked.filter(id => id !== turn)]
  }
  return ranked
}

/** The most likely starter on `date`, or null (no history / nobody rested). */
export function nextStarter(starts: Start[], date: string, opts: ProjectOptions): number | null {
  return rankStarters(starts, date, opts)[0] ?? null
}

/**
 * Starters for a team's upcoming games (in date order): an announced one is
 * kept, a missing one projected; each pick counts as a start for the next game.
 */
export function projectSeries(
  starts: Start[],
  games: Array<{ date: string; announced?: number | null }>,
  opts: ProjectOptions,
): Array<{ id: number | null; projected: boolean; opener?: number }> {
  const history = [...starts]
  return games.map(g => {
    const id = g.announced ?? nextStarter(history, g.date, opts)
    // A bulk arm whose last turn came behind an opener: projected with that opener again
    const lastTurn = id != null && g.announced == null ? [...history].reverse().find(s => s.pitcherId === id) : undefined
    const opener = lastTurn?.opener != null && !opts.unavailable?.has(lastTurn.opener) ? lastTurn.opener : undefined
    if (id != null) history.push({ date: g.date, pitcherId: id, pitches: 90, post: opts.postseason, opener })
    return { id, projected: g.announced == null && id != null, ...(opener != null ? { opener } : {}) }
  })
}

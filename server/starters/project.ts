// Projected starting pitcher for a game with no announced probable (pure: no
// database, see projectStarters in service.ts for the data and tests in
// tests/unit/starters.test.ts).
//
// The rotation is the team's last distinct real starters (35+ pitches), minus
// arms that haven't started in STALE_DAYS (hurt or sent down). In the regular
// season it's the turn — whoever started CYCLE_BACK games ago, if rested — and
// otherwise the member with the longest rest; in the postseason, with off days,
// teams go back to their best arms: among those rested, the lowest FIP.
//
// Backtest (npm run db:validate-starters), right / reachable (the real starter
// was in the rotation at all): 2025 regular 70.9% / 78.0%, postseason 52%;
// 2026 regular 69.1% / 76.1%, postseason 49%.

export interface Start {
  date: string        // YYYY-MM-DD
  pitcherId: number
  pitches: number
}

export interface ProjectOptions {
  postseason: boolean
  /** FIP (lower = better) by pitcher, to rank rested arms in the postseason. */
  quality?: Map<number, number>
  /** Not available (injured list, announced elsewhere…). */
  unavailable?: Set<number>
  /** Tuning (backtests): rotation size, days without a start that drop an arm, postseason ranking. */
  rotationSize?: number
  staleDays?: number
  postseasonRank?: 'fip' | 'rest'
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
  const order = (a: number, b: number) => opts.postseason && (opts.postseasonRank ?? 'fip') === 'fip'
    ? fip(a) - fip(b) || rest(b) - rest(a)
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
): Array<{ id: number | null; projected: boolean }> {
  const history = [...starts]
  return games.map(g => {
    const id = g.announced ?? nextStarter(history, g.date, opts)
    if (id != null) history.push({ date: g.date, pitcherId: id, pitches: 90 })
    return { id, projected: g.announced == null && id != null }
  })
}

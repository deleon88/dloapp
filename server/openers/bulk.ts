// Who pitches the bulk behind an opener? (pure, no I/O)
//
// The bulk arm is usually on a starter's cadence: in 2025-26 opener games,
// 54% of them came in exactly 5 or 6 days after their last long outing, 80%
// had a long outing in the previous 30 days, 43% had already been the bulk
// before. So candidates are the team's arms with a recent long outing, rested,
// scored by how well they fit that rhythm.

export interface TeamAppearance {
  pitcherId: number
  day: number            // days since an epoch (only differences matter)
  isStart: boolean
  outs: number
  pitches: number
  bulk: boolean          // came in behind an opener and went 3+ IP
}

export interface BulkCandidate {
  pitcherId: number
  score: number
  daysSinceLong: number
  longOutings: number    // in the last 30 days
  bulkBefore: boolean
}

export interface BulkPrediction {
  candidates: BulkCandidate[]   // best first (up to 3)
  confident: boolean            // top candidate clearly ahead: worth naming
}

export const isLong = (a: { outs: number; pitches: number }) => a.outs >= 9 || a.pitches >= 45

// Name the bulk arm only this far ahead of the next candidate. Backtest (flagged
// opener games, next game's starter excluded): right 87% of the time in 2026
// (52 of 132 games named), 76% in 2025 (17 of 67); lower gaps name more games
// but miss more (gap 1.5: 76% / 62%).
export const CONFIDENCE_GAP = 3

const WINDOW_DAYS = 30
const ACTIVE_DAYS = 15        // appeared this recently: still on the staff
const MIN_REST_AFTER_LONG = 4

/**
 * `history`: the team's appearances this season before the game (any order).
 * `today`: the game's day. `exclude`: the opener, the team's announced starter
 * for its next game (a rotation arm on the same cadence) and anyone known out.
 * `available`: active roster, when known (null = unknown).
 */
export function predictBulk(
  history: TeamAppearance[],
  today: number,
  exclude: Set<number>,
  available: Set<number> | null = null,
  confidenceGap = CONFIDENCE_GAP,
): BulkPrediction {
  const byPitcher = new Map<number, TeamAppearance[]>()
  for (const a of history) {
    if (a.day >= today || today - a.day > WINDOW_DAYS + 15) continue
    ;(byPitcher.get(a.pitcherId) ?? byPitcher.set(a.pitcherId, []).get(a.pitcherId)!).push(a)
  }

  const candidates: BulkCandidate[] = []
  for (const [pitcherId, apps] of byPitcher) {
    if (exclude.has(pitcherId) || (available && !available.has(pitcherId))) continue
    apps.sort((a, b) => b.day - a.day)
    const last = apps[0]
    if (today - last.day > ACTIVE_DAYS) continue
    const longs = apps.filter(a => isLong(a) && today - a.day <= WINDOW_DAYS)
    if (!longs.length) continue
    const daysSinceLong = today - longs[0].day
    // Rested: a long outing needs a few days; and not used the day before.
    if (daysSinceLong < MIN_REST_AFTER_LONG || today - last.day < 2) continue

    // 6 days is the most common gap (95 of 286), then 5 (60).
    const cadence = daysSinceLong === 6 ? 3 : daysSinceLong === 5 ? 2.5
      : daysSinceLong === 4 || daysSinceLong === 7 ? 1.5
      : daysSinceLong <= 10 ? 0.5 : 0
    const bulkBefore = apps.some(a => a.bulk)
    const score = cadence + (bulkBefore ? 2 : 0) + Math.min(longs.length, 3) * 0.5
      // Pitched since the long outing (short relief): less likely saved for today.
      - (last.day > longs[0].day && !isLong(last) ? 1 : 0)
    candidates.push({ pitcherId, score, daysSinceLong, longOutings: longs.length, bulkBefore })
  }

  candidates.sort((a, b) => b.score - a.score || b.daysSinceLong - a.daysSinceLong)
  const [first, second] = candidates
  const confident = first != null && (second == null || first.score - second.score >= confidenceGap)
  return { candidates: candidates.slice(0, 3), confident }
}


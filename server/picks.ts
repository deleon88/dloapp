// How picks turn out, and the streaks built from them (pure, no I/O).

export type PickResult = 'won' | 'lost' | 'pending' | 'void'

/** Postponed / cancelled = void; not final = pending; final without a winner (tie, rare) = void. */
export const pickResult = (status: string, state: string, winner: number | null, team: number): PickResult =>
  /^(Postponed|Cancelled)/.test(status) ? 'void'
    : state !== 'Final' ? 'pending'
    : winner == null ? 'void'
    : winner === team ? 'won' : 'lost'

export interface PickSummary {
  won: number
  lost: number
  pending: number
  pct: number | null                                  // won / decided, 0-100
  streak: { kind: 'won' | 'lost'; n: number } | null  // current run of decided picks
  bestStreak: number                                  // longest run of correct picks
}

/** Summary of a user's picks; `results` newest first. Pending and void picks don't break a streak. */
export function summarize(results: PickResult[]): PickSummary {
  const decided = results.filter((r): r is 'won' | 'lost' => r === 'won' || r === 'lost')
  const won = decided.filter(r => r === 'won').length

  let streak: PickSummary['streak'] = null
  for (const r of decided) {
    if (!streak) streak = { kind: r, n: 1 }
    else if (r === streak.kind) streak.n++
    else break
  }

  let bestStreak = 0, run = 0
  for (const r of decided) {
    run = r === 'won' ? run + 1 : 0
    bestStreak = Math.max(bestStreak, run)
  }

  return {
    won,
    lost: decided.length - won,
    pending: results.filter(r => r === 'pending').length,
    pct: decided.length ? Math.round((won / decided.length) * 100) : null,
    streak,
    bestStreak,
  }
}

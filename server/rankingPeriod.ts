// Date ranges of the leaderboard periods (pure; tests/unit/rankingPeriod.test.ts).

export type RankingPeriod = 'today' | 'week' | 'month' | 'season'

/**
 * ET date range (YYYY-MM-DD) of a period ending today: today; this week
 * (Monday–today); this month; the whole season (calendar year).
 */
export function periodRange(period: RankingPeriod, today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number)
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') {
    const date = new Date(Date.UTC(y, m - 1, d))
    const sinceMonday = (date.getUTCDay() + 6) % 7
    return { from: new Date(Date.UTC(y, m - 1, d - sinceMonday)).toISOString().slice(0, 10), to: today }
  }
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

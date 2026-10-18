/**
 * Calendar date (YYYY-MM-DD) in US Eastern time, `daysAgo` days back. MLB's
 * official game dates are ET; UTC dates push night games into the next day.
 */
export function etDate(daysAgo = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.now() - daysAgo * 86400000))
}

/** Hour (ET) at which the baseball day turns over. */
const MLB_DAY_START_HOUR = 6

/**
 * The baseball "today": the ET date, but it only turns over at 6 AM ET. Past
 * midnight ET it's still the previous night for fans further west (and late
 * games are still on), so "today" doesn't jump to tomorrow's slate yet.
 */
export function mlbToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.now() - MLB_DAY_START_HOUR * 3_600_000))
}

/** Shifts a YYYY-MM-DD date by whole days, without any time-zone conversion. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

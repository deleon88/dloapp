/**
 * Calendar date (YYYY-MM-DD) in US Eastern time, `daysAgo` days back. MLB's
 * official game dates are ET; UTC dates push night games into the next day.
 */
export function etDate(daysAgo = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date(Date.now() - daysAgo * 86400000))
}

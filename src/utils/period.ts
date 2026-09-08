export type StatPeriod = 'season' | 'season2025' | '60days' | '30days' | '14days' | '7days'

export const PERIOD_OPTIONS: { value: StatPeriod; label: string }[] = [
  { value: 'season',      label: '2026 Season'  },
  { value: 'season2025',  label: '2025 Season'  },
  { value: '60days',      label: 'Last 60 Days' },
  { value: '30days',      label: 'Last 30 Days' },
  { value: '14days',      label: 'Last 14 Days' },
  { value: '7days',       label: 'Last 7 Days'  },
]

/** Full closed season this year → 2025 (immutable, historical); everything else → current year. */
export function periodToSeason(period: StatPeriod): number {
  return period === 'season2025' ? 2025 : new Date().getFullYear()
}

/** True for a full-season view (no date range) — either the live current season or a closed historical one. */
export function isFullSeasonPeriod(period: StatPeriod): boolean {
  return period === 'season' || period === 'season2025'
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function getPeriodStartDate(period: StatPeriod): string {
  const d = new Date()
  const yr = d.getFullYear()
  switch (period) {
    case '60days': d.setDate(d.getDate() - 60); return fmtDate(d)
    case '30days': d.setDate(d.getDate() - 30); return fmtDate(d)
    case '14days': d.setDate(d.getDate() - 14); return fmtDate(d)
    case '7days':  d.setDate(d.getDate() - 7);  return fmtDate(d)
    default:       return `${yr}-03-01`
  }
}

export function todayStr(): string {
  return fmtDate(new Date())
}

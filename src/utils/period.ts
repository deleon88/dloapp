// El rango de fechas de cada periodo lo calcula el servidor (server/stats/batting.ts
// → resolvePeriod), contando hacia atrás desde el último día con juegos de
// temporada regular.
export type StatPeriod = 'season' | '60days' | '30days' | '14days' | '7days'

export const PERIOD_OPTIONS: { value: StatPeriod; label: string }[] = [
  { value: 'season',  label: '2026 Season'  },
  { value: '60days',  label: 'Last 60 Days' },
  { value: '30days',  label: 'Last 30 Days' },
  { value: '14days',  label: 'Last 14 Days' },
  { value: '7days',   label: 'Last 7 Days'  },
]

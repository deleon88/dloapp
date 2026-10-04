// El rango de fechas de cada periodo lo calcula el servidor (server/stats/batting.ts
// → resolvePeriod), contando hacia atrás desde el último día con juegos de
// temporada regular.
import type { TKey } from '@/i18n/useT'

export type StatPeriod = 'season' | '60days' | '30days' | '14days' | '7days'

export const PERIOD_OPTIONS: { value: StatPeriod }[] = [
  { value: 'season' },
  { value: '60days' },
  { value: '30days' },
  { value: '14days' },
  { value: '7days' },
]

/** Season the app shows, the same one the stats endpoints default to. */
export function currentSeason(): number {
  return new Date().getFullYear()
}

/** Translated period label; full season reads "2026 Season" / "Temp. 2026" with the current year. */
export function periodLabel(period: StatPeriod, t: (k: TKey) => string): string {
  return t(period).replace('{year}', String(currentSeason()))
}

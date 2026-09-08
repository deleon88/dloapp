/**
 * Persists the period + hand filter selection to localStorage so it survives
 * navigation between SchedulePage and LiveGamePage (and a full page reload).
 * Both pages read the same keys, so picking "Last 30 Days" + "vs LHP" on the
 * schedule and opening a game shows that same selection there, and vice versa.
 */

import { PERIOD_OPTIONS, type StatPeriod } from './period'
import {
  DEFAULT_HAND_FILTERS, HAND_VALUES, BATTER_HAND_VALUES,
  type HandFilters, type HandFilterValue, type BatterHandFilterValue,
} from './handFilter'

const PERIOD_KEY = 'dlp-filter-period-v1'
const HAND_KEY   = 'dlp-filter-hand-v1'

const VALID_PERIODS = new Set<string>(PERIOD_OPTIONS.map(o => o.value))
const VALID_PITCHER_HAND_VALUES = new Set<string>(HAND_VALUES)
const VALID_BATTER_HAND_VALUES  = new Set<string>(BATTER_HAND_VALUES)

export function loadSavedPeriod(): StatPeriod {
  try {
    const raw = localStorage.getItem(PERIOD_KEY)
    if (raw && VALID_PERIODS.has(raw)) return raw as StatPeriod
  } catch {
    // ignore — private browsing / storage unavailable
  }
  return 'season'
}

export function saveSavedPeriod(period: StatPeriod): void {
  try {
    localStorage.setItem(PERIOD_KEY, period)
  } catch {
    // ignore
  }
}

function isBatterHandFilterValue(v: unknown): v is BatterHandFilterValue {
  return typeof v === 'string' && VALID_BATTER_HAND_VALUES.has(v)
}

function isPitcherHandFilterValue(v: unknown): v is HandFilterValue {
  return typeof v === 'string' && VALID_PITCHER_HAND_VALUES.has(v)
}

export function loadSavedHandFilters(): HandFilters {
  try {
    const raw = localStorage.getItem(HAND_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HandFilters> | null
      if (parsed && isBatterHandFilterValue(parsed.batter) && isPitcherHandFilterValue(parsed.pitcher)) {
        return { batter: parsed.batter, pitcher: parsed.pitcher }
      }
    }
  } catch {
    // ignore — malformed JSON / storage unavailable
  }
  return DEFAULT_HAND_FILTERS
}

export function saveSavedHandFilters(filters: HandFilters): void {
  try {
    localStorage.setItem(HAND_KEY, JSON.stringify(filters))
  } catch {
    // ignore
  }
}

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import type { StatPeriod } from './period'
import { DEFAULT_HAND_FILTERS, type HandFilters } from './handFilter'
import { loadSavedHandFilters, loadSavedPeriod, saveSavedHandFilters, saveSavedPeriod } from './filterPreferences'

/**
 * Period and batter/pitcher-hand filters of the schedule and game pages,
 * saved across pages (filterPreferences). Filters are for signed-in users:
 * without a session the pages show full-season, all-hands numbers and the
 * controls ask to log in (`locked`). With login turned off (no Supabase
 * client), everyone can use them.
 */
export function useStatFilters() {
  const session = useAuthStore(s => s.session)
  const authLoading = useAuthStore(s => s.loading)
  const locked = supabase != null && !authLoading && !session

  const [period, setPeriodState] = useState<StatPeriod>(loadSavedPeriod)
  const [handFilters, setHandFiltersState] = useState<HandFilters>(loadSavedHandFilters)

  return {
    locked,
    period: locked ? 'season' : period,
    handFilters: locked ? DEFAULT_HAND_FILTERS : handFilters,
    setPeriod: (p: StatPeriod) => { if (locked) return; setPeriodState(p); saveSavedPeriod(p) },
    setHandFilters: (f: HandFilters) => { if (locked) return; setHandFiltersState(f); saveSavedHandFilters(f) },
  } as const
}

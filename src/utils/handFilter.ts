export type HandFilterValue = 'all' | 'L' | 'R'

/** Batters get a 4th option: 'starter' — resolves per-batter to the actual
 * opposing starting pitcher's hand (away batters vs the home starter, home
 * batters vs the away starter) instead of one hand applied to everyone. */
export type BatterHandFilterValue = HandFilterValue | 'starter'

export interface HandFilters {
  batter:  BatterHandFilterValue   // vs LHP / vs RHP / vs Starter Hand — MLB sitCodes (season) or PBP rollup (rolling windows), see wrcComputed.ts
  pitcher: HandFilterValue          // vs LHB / vs RHB — FanGraphs cron (season) or PBP rollup (rolling windows), see pitcherHandSplitsCache.ts
}

export const DEFAULT_HAND_FILTERS: HandFilters = { batter: 'all', pitcher: 'all' }

export const HAND_VALUES: HandFilterValue[] = ['all', 'L', 'R']
export const BATTER_HAND_VALUES: BatterHandFilterValue[] = ['all', 'L', 'R', 'starter']

export function batterLabelKey(v: BatterHandFilterValue): 'handAll' | 'handVsLHP' | 'handVsRHP' | 'handVsStarter' {
  return v === 'L' ? 'handVsLHP' : v === 'R' ? 'handVsRHP' : v === 'starter' ? 'handVsStarter' : 'handAll'
}

export function pitcherLabelKey(v: HandFilterValue): 'handAll' | 'handVsLHB' | 'handVsRHB' {
  return v === 'L' ? 'handVsLHB' : v === 'R' ? 'handVsRHB' : 'handAll'
}

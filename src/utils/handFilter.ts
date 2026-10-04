export type HandFilterValue = 'all' | 'L' | 'R'

/** Batters get a 4th option: 'starter' — resolves per-batter to the actual
 * opposing starting pitcher's hand (away batters vs the home starter, home
 * batters vs the away starter) instead of one hand applied to everyone. */
export type BatterHandFilterValue = HandFilterValue | 'starter'

export interface HandFilters {
  batter:  BatterHandFilterValue   // vs LHP / vs RHP / vs Starter Hand — vsL/vsR lines of /api/stats/batters
  pitcher: HandFilterValue          // vs LHB / vs RHB — pending: pitcher splits from the database
}

export const DEFAULT_HAND_FILTERS: HandFilters = { batter: 'all', pitcher: 'all' }

export const HAND_VALUES: HandFilterValue[] = ['all', 'L', 'R']
export const BATTER_HAND_VALUES: BatterHandFilterValue[] = ['all', 'L', 'R', 'starter']

/**
 * Which split a lineup should use. `opposingStarterHand` is the hand of the
 * starter that lineup faces; with 'starter' and no announced starter it
 * returns null (no value is better than the all-pitchers number mislabeled).
 */
export function batterSplitFor(
  filter: BatterHandFilterValue,
  opposingStarterHand: string | undefined,
): 'all' | 'L' | 'R' | null {
  if (filter === 'all') return 'all'
  if (filter !== 'starter') return filter
  return opposingStarterHand === 'L' || opposingStarterHand === 'R' ? opposingStarterHand : null
}

export function batterLabelKey(v: BatterHandFilterValue): 'handAll' | 'handVsLHP' | 'handVsRHP' | 'handVsStarter' {
  return v === 'L' ? 'handVsLHP' : v === 'R' ? 'handVsRHP' : v === 'starter' ? 'handVsStarter' : 'handAll'
}

export function pitcherLabelKey(v: HandFilterValue): 'handAll' | 'handVsLHB' | 'handVsRHB' {
  return v === 'L' ? 'handVsLHB' : v === 'R' ? 'handVsRHB' : 'handAll'
}

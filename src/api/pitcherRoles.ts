// Client for api/pitcher-roles.ts: is each probable starter a real starter or
// an opener (an inning or two before the bulk of the pitching)?

export type PitcherRole = 'starter' | 'opener'

export interface RoleInfo {
  role: PitcherRole
  apps: number
  reliefApps: number
  starts: number
  shortStarts: number
  avgOuts: number | null
  teamOpeners: number
}

export interface Probable {
  id: number
  teamId: number
}

/** Roles of the probable starters; each one's team tells how often it uses openers. */
export async function fetchPitcherRoles(probables: Probable[]): Promise<Map<number, RoleInfo>> {
  const unique = [...new Map(probables.map(p => [p.id, p])).values()].sort((a, b) => a.id - b.id)
  if (!unique.length) return new Map()
  const res = await fetch(`/api/pitcher-roles?ids=${unique.map(p => p.id).join(',')}&teams=${unique.map(p => p.teamId).join(',')}`)
  if (!res.ok) throw new Error(`pitcher-roles ${res.status}`)
  const body = await res.json() as { roles: Record<string, RoleInfo> }
  return new Map(Object.entries(body.roles).map(([id, r]) => [Number(id), r]))
}

/** Share of the starter's innings an opener covers; the rest goes to the bullpen. */
export const OPENER_SHARE = 0.3

/**
 * Value for the "starters" bar: the pitcher's own, or for an opener a blend
 * with the team's bullpen (who will cover most of the starter's innings).
 */
export function starterValue(own: number | undefined, isOpener: boolean, bullpen: number | undefined): number | undefined {
  if (!isOpener) return own
  if (own == null) return bullpen
  if (bullpen == null) return own
  return Math.round(OPENER_SHARE * own + (1 - OPENER_SHARE) * bullpen)
}

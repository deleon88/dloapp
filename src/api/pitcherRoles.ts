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
  /** Openers only: the arm expected to pitch most of the game behind them; null if unclear. */
  bulk?: BulkArm | null
}

export interface BulkArm {
  id: number
  fullName: string
  pitchHand: string | null
}

export interface Probable {
  id: number
  teamId: number
}

/**
 * Roles of the probable starters; each one's team tells how often it uses
 * openers. With the games' date, openers also come with their probable bulk arm.
 */
export async function fetchPitcherRoles(probables: Probable[], date?: string): Promise<Map<number, RoleInfo>> {
  const unique = [...new Map(probables.map(p => [p.id, p])).values()].sort((a, b) => a.id - b.id)
  if (!unique.length) return new Map()
  const res = await fetch(`/api/pitcher-roles?ids=${unique.map(p => p.id).join(',')}&teams=${unique.map(p => p.teamId).join(',')}${date ? `&date=${date}` : ''}`)
  if (!res.ok) throw new Error(`pitcher-roles ${res.status}`)
  const body = await res.json() as { roles: Record<string, RoleInfo> }
  return new Map(Object.entries(body.roles).map(([id, r]) => [Number(id), r]))
}

/** Share of the starter's innings an opener covers; the rest goes to the bullpen. */
export const OPENER_SHARE = 0.3

/**
 * Value for the "starters" bar: the pitcher's own, or for an opener a blend
 * with whoever covers most of the starter's innings: the probable bulk arm
 * when known, else the team's bullpen.
 */
export function starterValue(own: number | undefined, isOpener: boolean, bullpen: number | undefined, bulk?: number): number | undefined {
  if (!isOpener) return own
  const behind = bulk ?? bullpen
  if (own == null) return behind
  if (behind == null) return own
  return Math.round(OPENER_SHARE * own + (1 - OPENER_SHARE) * behind)
}

/** "Blake Snell" → "B. Snell" */
export const shortName = (n: string) => {
  const p = n.split(' ')
  return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n
}

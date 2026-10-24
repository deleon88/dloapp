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

// ── Projected starters (server/starters) ─────────────────────────────────────

/** A projected starter; an opener comes with the arm projected for the bulk behind them. */
export interface ProjectedStarter { id: number; fullName: string; bulk?: BulkArm }
/** gamePk → the projected starter of each side that has no announced probable. */
export type GameProjections = Record<string, { away?: ProjectedStarter; home?: ProjectedStarter }>

type Side = { probablePitcher?: { id: number; fullName: string; projected?: boolean; bulk?: BulkArm } }
interface ProjectableGame {
  gamePk: number
  status: { abstractGameState: string }
  teams: { away: object; home: object }
}

/**
 * Projected openers and their bulk arms in these games, by the opener's id:
 * the roles endpoint may not see a pitcher as an opener yet, the projection does.
 */
export function projectedBulks(games: Array<{ teams: { away: object; home: object } }>): Map<number, BulkArm> {
  const out = new Map<number, BulkArm>()
  for (const g of games) {
    for (const side of [g.teams.away, g.teams.home] as Side[]) {
      const p = side.probablePitcher
      if (p?.projected && p.bulk) out.set(p.id, p.bulk)
    }
  }
  return out
}

/** A game still to be played with a side whose starter isn't announced. */
export function missingProbable(g: ProjectableGame): boolean {
  const t = g.teams as { away: Side; home: Side }
  return g.status.abstractGameState === 'Preview' && (!t.away.probablePitcher || !t.home.probablePitcher)
}

/** Projected starters for the games of a date (YYYY-MM-DD) with none announced. */
export async function fetchProjectedStarters(date: string): Promise<GameProjections> {
  const res = await fetch(`/api/pitcher-roles?starters=${date}`)
  if (!res.ok) throw new Error(`pitcher-roles starters ${res.status}`)
  return ((await res.json()) as { games: GameProjections }).games
}

/**
 * The game with each missing probable filled in by its projection, flagged
 * `projected: true` so the cards can say so. Announced starters are kept.
 */
export function withProjectedStarters<G extends ProjectableGame>(game: G, proj: GameProjections | undefined): G {
  const p = proj?.[game.gamePk]
  if (!p) return game
  const teams = game.teams as { away: Side; home: Side }
  const fill = (side: Side, s?: ProjectedStarter): Side =>
    side.probablePitcher || !s ? side : { ...side, probablePitcher: { ...s, projected: true } }
  return { ...game, teams: { ...game.teams, away: fill(teams.away, p.away), home: fill(teams.home, p.home) } }
}

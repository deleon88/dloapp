// Client of /api/leaders (server/leaders/leaders.ts): every batter, pitcher or
// team of a season with its whole line, for the sortable Stats page.
import type { StatPeriod } from '@/utils/period'

export type LeaderType = 'bat' | 'pit' | 'team'
export type LeaderHand = 'all' | 'L' | 'R'
export type LeaderRole = 'all' | 'sp' | 'rp'

export interface BatLine {
  pa: number; ab: number; h: number; d2: number; d3: number; hr: number; rbi: number
  bb: number; so: number; hbp: number
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  iso: number | null; babip: number | null
  kPct: number | null; bbPct: number | null; kbbPct: number | null
  woba: number | null; wrcPlus: number | null
  gbPct: number | null; ldPct: number | null; fbPct: number | null; hrFb: number | null
}

export interface PitLine {
  bf: number; ip: number; so: number; bb: number; hr: number; h: number
  kPct: number | null; bbPct: number | null; kbbPct: number | null
  whip: number | null; fip: number | null; fipMinus: number | null; xfip: number | null
  hr9: number | null; babip: number | null; wobaAgainst: number | null; avgAgainst: number | null
  gbPct: number | null; ldPct: number | null; fbPct: number | null; hrFb: number | null
}

export interface BatterRow extends BatLine {
  id: number; name: string; team: number; pos: string; g: number
  /** Runs / steals: only without a hand filter (MLB has no split). */
  r?: number | null; sb?: number | null; cs?: number | null
}

export interface PitcherRow extends PitLine {
  id: number; name: string; team: number; throws: string | null; g: number; gs: number
  /** ERA / decisions: not with a hand filter, nor a role inside a date window. */
  era?: number | null; w?: number | null; l?: number | null; sv?: number | null; hld?: number | null
}

export interface TeamRow {
  id: number; g: number; w: number | null; l: number | null
  r: number; sb: number | null; era: number | null
  bat: BatLine; pit: PitLine
}

export interface LeadersQuery {
  type: LeaderType
  season: number
  period: StatPeriod
  hand: LeaderHand
  role: LeaderRole
}

export type LeadersResponse =
  | { type: 'bat'; teamGames: Record<string, number>; players: BatterRow[] }
  | { type: 'pit'; teamGames: Record<string, number>; players: PitcherRow[]; recordsAvailable: boolean }
  | { type: 'team'; teams: TeamRow[] }

export async function fetchLeaders(q: LeadersQuery): Promise<LeadersResponse> {
  const params = new URLSearchParams({ type: q.type, season: String(q.season) })
  if (q.period !== 'season') params.set('period', q.period)
  if (q.hand !== 'all') params.set('hand', q.hand)
  if (q.role !== 'all' && q.type !== 'bat') params.set('role', q.role)
  const res = await fetch(`/api/leaders?${params}`)
  if (!res.ok) throw new Error(`leaders ${res.status}`)
  return res.json() as Promise<LeadersResponse>
}

// Client for /api/stats/pitchers: pitching stats computed by our backend from
// the play-by-play (see server/stats/pitching.ts), plus ERA/W-L from MLB.
import type { StatPeriod } from '@/utils/period'
import type { LeagueKey } from '@/data/leagues'

export interface PitcherSplit {
  bf: number
  ip: number               // decimal innings
  so: number
  bb: number
  hbp: number
  hr: number
  h: number
  kbbPct: number | null
  whip: number | null
  fip: number | null
  fipMinus: number | null
  xfip: number | null
  wobaAgainst: number | null
  opsAgainst: number | null
  /** OPS+ allowed vs the league in the same split (100 = average, lower is better). */
  opsPlusAgainst: number | null
}

export interface PitcherRecord {
  era: string | null
  wins: number | null
  losses: number | null
  qualityStarts: number | null
}

export interface PitcherLine extends PitcherSplit {
  vsL: PitcherSplit        // vs left-handed batters
  vsR: PitcherSplit
  record: PitcherRecord | null
}

export interface PitcherLinesOptions {
  /** MLB by default: only the batters faced in that league count. */
  league?: LeagueKey
  season?: number
  period?: StatPeriod
  /** 'rp' = relief appearances only (bullpen). */
  role?: 'all' | 'rp'
}

const CHUNK = 150

export async function fetchPitcherLines(
  pitcherIds: number[],
  opts: PitcherLinesOptions = {},
): Promise<Map<number, PitcherLine>> {
  const ids = [...new Set(pitcherIds)].sort((a, b) => a - b)
  if (!ids.length) return new Map()

  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK))
  const results = await Promise.all(chunks.map(async chunk => {
    const params = new URLSearchParams({ ids: chunk.join(',') })
    if (opts.season) params.set('season', String(opts.season))
    if (opts.period && opts.period !== 'season') params.set('period', opts.period)
    if (opts.role === 'rp') params.set('role', 'rp')
    if (opts.league && opts.league !== 'MLB') params.set('league', opts.league)
    const res = await fetch(`/api/stats/pitchers?${params}`)
    if (!res.ok) throw new Error(`stats/pitchers ${res.status}`)
    return ((await res.json()) as { players: Record<string, PitcherLine> }).players
  }))

  const out = new Map<number, PitcherLine>()
  for (const r of results) for (const [id, line] of Object.entries(r)) out.set(Number(id), line)
  return out
}

export type TeamReliefLine = PitcherSplit & { vsL: PitcherSplit; vsR: PitcherSplit }

/** Each team's relief line: every relief appearance for it in the period, added up. */
export async function fetchTeamReliefLines(
  teamIds: number[],
  opts: Omit<PitcherLinesOptions, 'role'> = {},
): Promise<Map<number, TeamReliefLine>> {
  const ids = [...new Set(teamIds)].sort((a, b) => a - b)
  if (!ids.length) return new Map()
  const params = new URLSearchParams({ teams: ids.join(','), role: 'rp' })
  if (opts.season) params.set('season', String(opts.season))
  if (opts.period && opts.period !== 'season') params.set('period', opts.period)
  if (opts.league && opts.league !== 'MLB') params.set('league', opts.league)
  const res = await fetch(`/api/stats/pitchers?${params}`)
  if (!res.ok) throw new Error(`stats/pitchers ${res.status}`)
  const { teams } = (await res.json()) as { teams: Record<string, TeamReliefLine> }
  return new Map(Object.entries(teams).map(([id, line]) => [Number(id), line]))
}

export type GuideStat = 'era' | 'fip' | 'xfip' | 'whip' | 'kbb' | 'woba'

/** The pitcher card guide: league averages and six tier cut-offs (best first) per stat. */
export interface PitchingGuide {
  season: number
  pitchers: number
  avg: Record<GuideStat, number>
  tiers: Record<GuideStat, [number, number, number, number, number, number]>
}

export async function fetchPitchingGuide(season: number, league: LeagueKey = 'MLB'): Promise<PitchingGuide> {
  const res = await fetch(`/api/stats/pitchers?guide=1&season=${season}${league !== 'MLB' ? `&league=${league}` : ''}`)
  if (!res.ok) throw new Error(`stats/pitchers guide ${res.status}`)
  return res.json() as Promise<PitchingGuide>
}

/** Decimal innings → baseball notation ("150.2"). */
export function formatIp(ip: number): string {
  const outs = Math.round(ip * 3)
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

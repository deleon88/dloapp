// Client for /api/stats/pitchers: pitching stats computed by our backend from
// the play-by-play (see server/stats/pitching.ts), plus ERA/W-L from MLB.
import type { StatPeriod } from '@/utils/period'

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
    const res = await fetch(`/api/stats/pitchers?${params}`)
    if (!res.ok) throw new Error(`stats/pitchers ${res.status}`)
    return ((await res.json()) as { players: Record<string, PitcherLine> }).players
  }))

  const out = new Map<number, PitcherLine>()
  for (const r of results) for (const [id, line] of Object.entries(r)) out.set(Number(id), line)
  return out
}

/** Decimal innings → baseball notation ("150.2"). */
export function formatIp(ip: number): string {
  const outs = Math.round(ip * 3)
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

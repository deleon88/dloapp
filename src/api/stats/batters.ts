// Cliente de /api/stats/batters: wOBA, wRC+, OPS y HR calculados en nuestro
// backend desde el play-by-play (ver server/stats/batting.ts).
import type { StatPeriod } from '@/utils/period'

export interface SplitLine {
  pa: number
  woba: number | null
  wrcPlus: number | null
  ops: number | null
  hr: number
  rbi: number
}

export interface BatterLine extends SplitLine {
  vsL: SplitLine
  vsR: SplitLine
}

export interface BatterLinesOptions {
  season?: number
  period?: StatPeriod   // el servidor calcula el rango de fechas
}

const CHUNK = 150   // el endpoint acepta hasta 200 ids por petición

async function fetchChunk(ids: number[], opts: BatterLinesOptions): Promise<Record<string, BatterLine>> {
  const params = new URLSearchParams({ ids: ids.join(',') })
  if (opts.season) params.set('season', String(opts.season))
  if (opts.period && opts.period !== 'season') params.set('period', opts.period)

  const res = await fetch(`/api/stats/batters?${params}`)
  if (!res.ok) throw new Error(`stats/batters ${res.status}`)
  const data = (await res.json()) as { players: Record<string, BatterLine> }
  return data.players
}

export async function fetchBatterLines(
  playerIds: number[],
  opts: BatterLinesOptions = {},
): Promise<Map<number, BatterLine>> {
  const ids = [...new Set(playerIds)]
  if (!ids.length) return new Map()

  // Ids ordenados: misma URL para el mismo grupo de jugadores, así el CDN la reutiliza.
  ids.sort((a, b) => a - b)
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK))
  const results = await Promise.all(chunks.map(c => fetchChunk(c, opts)))

  const out = new Map<number, BatterLine>()
  for (const r of results) for (const [id, line] of Object.entries(r)) out.set(Number(id), line)
  return out
}

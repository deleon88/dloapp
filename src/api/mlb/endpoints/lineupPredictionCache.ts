import { format } from 'date-fns'
import type { TeamPredictions } from './predictedLineup'

const PREFIX = 'dlp-lineup-pred-v5'
const TTL_MS = 20 * 60 * 60 * 1000  // 20 hours — covers same calendar day safely

interface CacheEntry {
  date: string  // YYYY-MM-DD
  data: TeamPredictions
}

function key(teamId: number): string {
  return `${PREFIX}-${teamId}`
}

export function getCachedPredictions(teamId: number): TeamPredictions | null {
  try {
    const raw = localStorage.getItem(key(teamId))
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    const today = format(new Date(), 'yyyy-MM-dd')
    if (entry.date !== today) return null
    if (Date.now() - entry.data.generatedAt > TTL_MS) return null
    return entry.data
  } catch {
    return null
  }
}

export function setCachedPredictions(teamId: number, data: TeamPredictions): void {
  try {
    const entry: CacheEntry = { date: format(new Date(), 'yyyy-MM-dd'), data }
    localStorage.setItem(key(teamId), JSON.stringify(entry))
  } catch {
    // localStorage unavailable (private browsing, storage full) — silently skip
  }
}

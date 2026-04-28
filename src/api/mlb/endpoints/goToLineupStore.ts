import type { PlayerPrediction, TeamPredictions } from './predictedLineup'

const STORE_KEY = 'dlp-go-to-lineups-v1'
const TTL_MS    = 7 * 24 * 60 * 60 * 1000  // 7 days — stable across the week

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoToEntry {
  savedAt: number
  vsRHP:   PlayerPrediction[]
  vsLHP:   PlayerPrediction[]
}

type GoToStore = Record<string, GoToEntry>  // key = teamId string

// ── I/O ───────────────────────────────────────────────────────────────────────

function load(): GoToStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persist(store: GoToStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // ignore — private browsing / storage full
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GoToLineup {
  vsRHP: PlayerPrediction[]
  vsLHP: PlayerPrediction[]
}

/** Returns the stored go-to lineup for a team, or null if absent / expired. */
export function getGoToLineup(teamId: number): GoToLineup | null {
  const entry = load()[String(teamId)]
  if (!entry) return null
  if (Date.now() - entry.savedAt > TTL_MS) return null
  return { vsRHP: entry.vsRHP, vsLHP: entry.vsLHP }
}

/**
 * Persists the freshly-computed predictions as this team's go-to lineup.
 * Called after every successful `fetchTeamPredictions` call so the store
 * accumulates across season-long app usage.
 */
export function setGoToLineup(teamId: number, preds: TeamPredictions): void {
  const store = load()
  store[String(teamId)] = {
    savedAt: Date.now(),
    vsRHP:   preds.vsRHP ?? [],
    vsLHP:   preds.vsLHP ?? [],
  }
  persist(store)
}

/**
 * Returns the full go-to store as a formatted JSON string.
 * Useful for exporting / debugging all 30 teams at once.
 */
export function exportGoToLineupsJSON(): string {
  return JSON.stringify(load(), null, 2)
}

/**
 * Returns a Set of player IDs that appear in the given go-to hand lineup.
 * Used by the prediction algorithm as a frequency tiebreaker.
 */
export function goToIdSet(lineup: PlayerPrediction[] | undefined | null): Set<number> {
  return new Set((lineup ?? []).map(p => p.id))
}

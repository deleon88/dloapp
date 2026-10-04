import { setMlbTeams, useTeamsVersion, type MlbTeamMeta } from './teams'
import { setLmbTeams } from './lmbTeams'

/**
 * Fetches the team data from the database (/api/teams) once per page load and
 * swaps it in if it differs from the bundled copy. On failure the bundled copy
 * stays, so the app always has colors.
 */
let pending: Promise<void> | null = null

export function loadTeams(): Promise<void> {
  // Once per page load, however many times it's called (e.g. React StrictMode).
  return (pending ??= fetchTeams())
}

async function fetchTeams(): Promise<void> {
  try {
    const res = await fetch('/api/teams')
    if (!res.ok) return
    const data = (await res.json()) as { mlb: MlbTeamMeta[]; lmb: Array<{ code: string; color: string; color2: string }> }
    const mlbChanged = setMlbTeams(data.mlb)
    const lmbChanged = setLmbTeams(data.lmb)
    if (mlbChanged || lmbChanged) useTeamsVersion.setState(s => ({ version: s.version + 1 }))
  } catch {
    // keep the bundled copy
  }
}

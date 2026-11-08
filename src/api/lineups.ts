// Client for the go-to lineups (api/lineups.ts): each team's lineup vs RHP and
// vs LHP, built on the server from its last 5 lineups against that hand,
// checked against the active roster, injured list and depth chart.
import type { LeagueKey } from '@/data/leagues'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'

export interface PlayerPrediction extends LineupSlot {
  battingSpot: number
  confidence: number      // 0-100: share of the sample games batting in this spot
  recentStarts: number    // starts in the team's last 10 games
  status: 'active' | 'returning'
}

export interface HandLineup {
  lineup: PlayerPrediction[] | null
  games: number[]         // games used, newest first
  fallback: boolean       // <2 games vs that hand: the last 5 overall were used
}

export interface TeamGoTo {
  teamId: number
  season: number
  vsRHP: HandLineup
  vsLHP: HandLineup
  computedAt: string
}

/** Go-to lineups by team id (the teams of one league; LIDOM's are tuned to its roster turnover). */
export async function fetchGoToLineups(teamIds: number[], league: LeagueKey = 'MLB', season?: number): Promise<Map<number, TeamGoTo>> {
  const ids = [...new Set(teamIds)].sort((a, b) => a - b)
  if (!ids.length) return new Map()
  const params = new URLSearchParams({ teams: ids.join(',') })
  if (league !== 'MLB') params.set('league', league)
  if (season) params.set('season', String(season))
  const res = await fetch(`/api/lineups?${params}`)
  if (!res.ok) throw new Error(`lineups ${res.status}`)
  const body = await res.json() as { teams: TeamGoTo[] }
  return new Map(body.teams.map(t => [t.teamId, t]))
}

/** The lineup for the opposing starter's hand; vs RHP when the hand is unknown (most starters). */
export function goToFor(team: TeamGoTo | undefined, opposingHand: string | undefined): PlayerPrediction[] | null {
  if (!team) return null
  return (opposingHand === 'L' ? team.vsLHP.lineup : team.vsRHP.lineup) ?? team.vsRHP.lineup ?? null
}

// The lineups used to be computed and cached in the browser: drop those keys.
try {
  for (const k of Object.keys(localStorage)) {
    if (k === 'dlp-go-to-lineups-v1' || k.startsWith('dlp-lineup-pred-')) localStorage.removeItem(k)
  }
} catch { /* storage unavailable */ }

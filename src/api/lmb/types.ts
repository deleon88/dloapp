export interface LmbTeam {
  teamUuid: string
  urlLogo: string
  name: string
  shortName: string
  winGames: number
  lostGames: number
  runsScored: number
  probablePitcher: string  // calendar API: plain string name
}

export interface LmbGame {
  gameId: number
  status: string        // 'P' = upcoming, 'F' = final, others = live
  detailedStatus: string
  canceledSubStatus: string
  date_time: number     // unix timestamp (seconds)
  hora: string          // '19:00'
  inning: { number: number; part: string }
  awayTeam: LmbTeam
  localTeam: LmbTeam
  bases: { first: number; second: number; third: number }
  strikes: number
  balls: number
  outs: number
  pitcher: { name: string; stats: string }
  batter: { name: string; stats: string }
  stadium?: string
  stadiumCity?: string
  lineScore?: Array<{ inningNumber: number; homeTeamRuns: number; awayTeamRuns: number }>
}

export interface LmbScheduleResponse {
  games_info: LmbGame[]
  nextGameDate?: number
}

// ── Detail API ───────────────────────────────────────────────────

export interface LmbProbablePitcher {
  permalink: string   // e.g., "/656954"
  name: string
  stats: string       // e.g., "3.45 ERA"
  extraStats: string  // e.g., "2 - 1"
  imageUrl: string
}

export interface LmbLineupPlayer {
  name: string
  position: string
  permalink: string
}

export interface LmbBatterStat {
  battingOrderPosition: number
  name: string
  position: string
  permalink: string
  ab: number; r: number; h: number; rbi: number; hr: number
  bb: number; so: number; avg: string; ops: string
}

export interface LmbDetailTeam extends Omit<LmbTeam, 'probablePitcher'> {
  probablePitcher: LmbProbablePitcher
  lineupMatchup: LmbLineupPlayer[]
  battingStats: LmbBatterStat[]
}

export interface LmbGameDetail extends Omit<LmbGame, 'awayTeam' | 'localTeam'> {
  awayTeam: LmbDetailTeam
  localTeam: LmbDetailTeam
  leagueName: string
  stadium: string
  stadiumCity: string
  lineScore: Array<{ inningNumber: number; homeTeamRuns: number; awayTeamRuns: number }>
}

export interface LmbDetailResponse {
  games_info: LmbGameDetail[]
}

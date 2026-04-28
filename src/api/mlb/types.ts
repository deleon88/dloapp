// ─── Shared primitives ───────────────────────────────────────────────────────

export interface MlbRef {
  id: number
  link: string
}

export interface NamedRef extends MlbRef {
  name: string
}

export interface CodedRef extends MlbRef {
  code: string
  description?: string
}

// ─── Venue ───────────────────────────────────────────────────────────────────

export interface Venue extends NamedRef {
  location?: {
    city: string
    state: string
    stateAbbrev: string
    country: string
    defaultCoordinates?: { latitude: number; longitude: number }
  }
  timeZone?: { id: string; offset: number; tz: string }
  active: boolean
}

// ─── Team ────────────────────────────────────────────────────────────────────

export interface Team extends NamedRef {
  teamName: string
  shortName: string
  abbreviation: string
  teamCode: string
  fileCode: string
  firstYearOfPlay: string
  locationName: string
  clubName: string
  active: boolean
  division?: NamedRef
  league?: NamedRef
  sport?: NamedRef
  venue?: Venue
  springVenue?: MlbRef
  record?: TeamRecord
}

export interface TeamRecord {
  gamesPlayed: number
  wildCardGamesBack: string
  leagueGamesBack: string
  springLeagueGamesBack: string
  sportGamesBack: string
  divisionGamesBack: string
  conferenceGamesBack: string
  leagueRecord: { wins: number; losses: number; ties: number; pct: string }
  records: Record<string, unknown>
  divisionLeader: boolean
  wins: number
  losses: number
  winningPercentage: string
}

// ─── Person / Player ─────────────────────────────────────────────────────────

export interface Person extends MlbRef {
  fullName: string
  firstName: string
  lastName: string
  primaryNumber?: string
  birthDate?: string
  currentAge?: number
  birthCity?: string
  birthStateProvince?: string
  birthCountry?: string
  height?: string
  weight?: number
  active: boolean
  primaryPosition?: Position
  useName?: string
  middleName?: string
  boxscoreName?: string
  nickName?: string
  gender?: string
  nameMatrilineal?: string
  isPlayer?: boolean
  isVerified?: boolean
  mlbDebutDate?: string
  batSide?: { code: string; description: string }
  pitchHand?: { code: string; description: string }
  nameFirstLast?: string
  nameSlug?: string
  firstLastName?: string
  lastFirstName?: string
  lastInitName?: string
  initLastName?: string
  fullFMLName?: string
  fullLFMName?: string
  strikeZoneTop?: number
  strikeZoneBottom?: number
  currentTeam?: NamedRef
}

export interface Position {
  code: string
  name: string
  type: string
  abbreviation: string
}

// ─── Schedule / Game ─────────────────────────────────────────────────────────

export type GameType = 'S' | 'R' | 'F' | 'D' | 'L' | 'W' | 'C' | 'N' | 'A' | 'E' | 'I'

export type GameStatus =
  | 'Preview'
  | 'Pre-Game'
  | 'Warmup'
  | 'In Progress'
  | 'Manager Challenge'
  | 'Delayed'
  | 'Suspended'
  | 'Final'
  | 'Game Over'
  | 'Postponed'
  | 'Cancelled'

export interface GameStatusDetail {
  abstractGameState: 'Preview' | 'Live' | 'Final'
  codedGameState: string
  detailedState: GameStatus
  statusCode: string
  startTimeTBD: boolean
  abstractGameCode: 'P' | 'L' | 'F'
}

export interface ScheduledGame {
  gamePk: number
  gameGuid: string
  link: string
  gameType: GameType
  season: string
  gameDate: string
  officialDate: string
  status: GameStatusDetail
  teams: {
    away: ScheduledTeam
    home: ScheduledTeam
  }
  venue: NamedRef
  content: MlbRef
  isTie?: boolean
  gameNumber: number
  publicFacing: boolean
  doubleHeader: 'N' | 'Y' | 'S'
  gamedayType: string
  tiebreaker: 'N' | 'Y'
  calendarEventID: string
  seasonDisplay: string
  dayNight: 'day' | 'night'
  scheduledInnings: number
  reverseHomeAwayStatus: boolean
  inningBreakLength: number
  gamesInSeries: number
  seriesGameNumber: number
  seriesDescription: string
  recordSource: string
  ifNecessary: string
  ifNecessaryDescription: string
}

export interface ScheduledTeam {
  leagueRecord: { wins: number; losses: number; pct: string }
  score?: number
  team: NamedRef
  isWinner?: boolean
  splitSquad: boolean
  seriesNumber: number
}

export interface ScheduleResponse {
  copyright: string
  totalItems: number
  totalEvents: number
  totalGames: number
  totalGamesInProgress: number
  dates: Array<{
    date: string
    totalItems: number
    totalEvents: number
    totalGames: number
    totalGamesInProgress: number
    games: ScheduledGame[]
    events: unknown[]
  }>
}

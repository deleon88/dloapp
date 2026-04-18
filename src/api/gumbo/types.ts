// ─── GUMBO (Grand Unified Master Baseball Object) types ──────────────────────
// Represents the live game feed returned by /game/{gamePk}/feed/live

export interface GumboFeed {
  copyright: string
  gamePk: number
  link: string
  metaData: GumboMetaData
  gameData: GumboGameData
  liveData: GumboLiveData
}

export interface GumboMetaData {
  wait: number
  timeStamp: string
  gameEvents: string[]
  logicalEvents: string[]
}

// ─── gameData ────────────────────────────────────────────────────────────────

export interface GumboGameData {
  game: {
    pk: number
    type: string
    doubleHeader: string
    id: string
    gamedayType: string
    tiebreaker: string
    gameNumber: number
    calendarEventID: string
    season: string
    seasonDisplay: string
  }
  datetime: {
    dateTime: string
    originalDate: string
    officialDate: string
    dayNight: string
    time: string
    ampm: string
  }
  status: {
    abstractGameState: 'Preview' | 'Live' | 'Final'
    codedGameState: string
    detailedState: string
    statusCode: string
    startTimeTBD: boolean
    abstractGameCode: string
  }
  teams: {
    away: GumboTeam
    home: GumboTeam
  }
  players: Record<string, GumboPlayer>
  venue: GumboVenue
  officialVenue: { id: number; link: string }
  weather?: {
    condition: string
    temp: string
    wind: string
  }
  gameInfo: {
    attendance?: number
    firstPitch?: string
    gameDurationMinutes?: number
  }
  review: {
    hasChallenges: boolean
    away: { used: number; remaining: number }
    home: { used: number; remaining: number }
  }
  flags: {
    noHitter: boolean
    perfectGame: boolean
    awayTeamNoHitter: boolean
    awayTeamPerfectGame: boolean
    homeTeamNoHitter: boolean
    homeTeamPerfectGame: boolean
  }
  alerts: unknown[]
  probablePitchers: {
    away?: GumboPlayerRef
    home?: GumboPlayerRef
  }
  officialScorer?: GumboPlayerRef
  primaryDatacaster?: GumboPlayerRef
}

export interface GumboTeam {
  id: number
  name: string
  link: string
  season: number
  venue: { id: number; name: string; link: string }
  teamStats: GumboTeamStats
  players: Record<string, GumboRosterPlayer>
  batters: number[]
  pitchers: number[]
  bench: number[]
  bullpen: number[]
  battingOrder: number[]
  info: GumboTeamInfo[]
  note: string
  teamName: string
  locationName: string
  firstYearOfPlay: string
  league: { id: number; name: string; link: string }
  division: { id: number; name: string; link: string }
  sport: { id: number; link: string; name: string }
  shortName: string
  record?: {
    gamesPlayed: number
    wildCardGamesBack: string
    leagueGamesBack: string
    divisionGamesBack: string
    wins: number
    losses: number
    winningPercentage: string
  }
  springLeague?: { id: number; name: string; link: string; abbreviation: string }
  allStarStatus: string
  active: boolean
}

export interface GumboTeamStats {
  batting: Record<string, number | string>
  pitching: Record<string, number | string>
  fielding: Record<string, number | string>
}

export interface GumboTeamInfo {
  title: string
  fieldList: Array<{ label: string; value: string }>
}

export interface GumboPlayerRef {
  id: number
  fullName: string
  link: string
}

export interface GumboPlayer extends GumboPlayerRef {
  firstName: string
  lastName: string
  primaryNumber: string
  birthDate: string
  currentAge: number
  birthCity: string
  birthStateProvince?: string
  birthCountry: string
  height: string
  weight: number
  active: boolean
  primaryPosition: { code: string; name: string; type: string; abbreviation: string }
  useName: string
  boxscoreName: string
  gender: string
  isPlayer: boolean
  isVerified: boolean
  mlbDebutDate?: string
  batSide: { code: string; description: string }
  pitchHand: { code: string; description: string }
  nameFirstLast: string
  strikeZoneTop: number
  strikeZoneBottom: number
}

export interface GumboRosterPlayer {
  person: GumboPlayerRef
  jerseyNumber: string
  position: { code: string; name: string; type: string; abbreviation: string }
  status: { code: string; description: string }
  parentTeamId: number
  battingOrder?: string
  stats: {
    batting: Record<string, number | string>
    pitching: Record<string, number | string>
    fielding: Record<string, number | string>
  }
  seasonStats: {
    batting: Record<string, number | string>
    pitching: Record<string, number | string>
    fielding: Record<string, number | string>
  }
  gameStatus: { isCurrentBatter: boolean; isCurrentPitcher: boolean; isOnBench: boolean; isSubstitute: boolean }
  allPositions?: Array<{ code: string; name: string; type: string; abbreviation: string }>
}

export interface GumboVenue {
  id: number
  name: string
  link: string
  location: {
    address1: string
    city: string
    state: string
    stateAbbrev: string
    postalCode: string
    defaultCoordinates: { latitude: number; longitude: number }
    country: string
    phone: string
  }
  timeZone: { id: string; offset: number; offsetAtGameTime: number; tz: string }
  fieldInfo: {
    capacity: number
    turfType: string
    roofType: string
    leftLine: number
    left: number
    leftCenter: number
    center: number
    rightCenter: number
    right: number
    rightLine: number
  }
  active: boolean
}

// ─── liveData ────────────────────────────────────────────────────────────────

export interface GumboLiveData {
  plays: GumboPlays
  linescore: GumboLinescore
  boxscore: GumboBoxscore
  decisions?: GumboDecisions
  leaders: GumboLeaders
}

export interface GumboPlays {
  allPlays: GumboPlay[]
  currentPlay?: GumboPlay
  scoringPlays: number[]
  playsByInning: GumboPlaysByInning[]
}

export interface GumboPlay {
  result: {
    type: string
    event: string
    eventType: string
    description: string
    rbi: number
    awayScore: number
    homeScore: number
    isOut: boolean
  }
  about: {
    atBatIndex: number
    halfInning: 'top' | 'bottom'
    isTopInning: boolean
    inning: number
    startTime: string
    endTime: string
    isComplete: boolean
    isScoringPlay: boolean
    hasReview: boolean
    hasOut: boolean
    captivatingIndex: number
  }
  count: GumboCount
  matchup: {
    batter: GumboPlayerRef
    batSide: { code: string; description: string }
    pitcher: GumboPlayerRef
    pitchHand: { code: string; description: string }
    batterHotColdZones?: unknown[]
    pitcherHotColdZones?: unknown[]
    splits: { batter: string; pitcher: string; menOnBase: string }
    postOnFirst?: GumboPlayerRef
    postOnSecond?: GumboPlayerRef
    postOnThird?: GumboPlayerRef
  }
  pitchIndex: number[]
  actionIndex: number[]
  runnerIndex: number[]
  runners: GumboRunner[]
  playEvents: GumboPlayEvent[]
  playEndTime: string
  atBatIndex: number
}

export interface GumboCount {
  balls: number
  strikes: number
  outs: number
}

export interface GumboRunner {
  movement: {
    originBase: string | null
    start: string | null
    end: string | null
    outBase: string | null
    isOut: boolean
    outNumber: number | null
  }
  details: {
    event: string
    eventType: string
    movementReason: string | null
    runner: GumboPlayerRef
    responsiblePitcher: GumboPlayerRef | null
    isScoringEvent: boolean
    rbi: boolean
    earned: boolean
    teamUnearned: boolean
    playIndex: number
  }
  credits: unknown[]
}

export interface GumboPlayEvent {
  details: {
    call?: { code: string; description: string }
    description: string
    code?: string
    ballColor?: string
    trailColor?: string
    isInPlay: boolean
    isStrike: boolean
    isBall: boolean
    type?: { code: string; description: string }
    isOut?: boolean
    hasReview?: boolean
    fromCatcher?: boolean
    runnerGoing?: boolean
  }
  count: GumboCount
  pitchData?: GumboPitchData
  hitData?: GumboHitData
  index: number
  playId?: string
  pitchNumber?: number
  startTime: string
  endTime: string
  isPitch: boolean
  type: 'pitch' | 'action' | 'no_pitch' | 'pickoff'
}

export interface GumboPitchData {
  startSpeed: number
  endSpeed: number
  strikeZoneTop: number
  strikeZoneBottom: number
  coordinates: {
    aY: number; aZ: number; pfxX: number; pfxZ: number
    pX: number; pZ: number; vX0: number; vY0: number; vZ0: number
    x: number; y: number; x0: number; y0: number; z0: number
    aX: number
  }
  breaks: {
    breakAngle: number
    breakLength: number
    breakY: number
    breakVertical: number
    breakVerticalInduced: number
    breakHorizontal: number
    spinRate: number
    spinDirection: number
  }
  zone: number
  typeConfidence: number
  plateTime: number
  extension: number
}

export interface GumboHitData {
  launchSpeed: number
  launchAngle: number
  totalDistance: number
  trajectory: string
  hardness: string
  location: string
  coordinates: { coordX: number; coordY: number }
}

export interface GumboPlaysByInning {
  startIndex: number
  endIndex: number
  top: number[]
  bottom: number[]
  hits: {
    away: Array<{ team: { id: number; name: string; link: string }; inning: number; pitcher: GumboPlayerRef; batter: GumboPlayerRef; coordinates: { coordX: number; coordY: number }; type: string; description: string }>
    home: Array<{ team: { id: number; name: string; link: string }; inning: number; pitcher: GumboPlayerRef; batter: GumboPlayerRef; coordinates: { coordX: number; coordY: number }; type: string; description: string }>
  }
}

export interface GumboLinescore {
  currentInning?: number
  currentInningOrdinal?: string
  inningState?: string
  inningHalf?: string
  isTopInning?: boolean
  scheduledInnings: number
  innings: GumboInning[]
  teams: {
    home: GumboLinescoreTeam
    away: GumboLinescoreTeam
  }
  defense: {
    pitcher?: GumboPlayerRef
    catcher?: GumboPlayerRef
    first?: GumboPlayerRef
    second?: GumboPlayerRef
    third?: GumboPlayerRef
    shortstop?: GumboPlayerRef
    left?: GumboPlayerRef
    center?: GumboPlayerRef
    right?: GumboPlayerRef
    batter?: GumboPlayerRef
    onDeck?: GumboPlayerRef
    inHole?: GumboPlayerRef
    battingOrder?: number
    team?: GumboPlayerRef
  }
  offense: {
    batter?: GumboPlayerRef
    onDeck?: GumboPlayerRef
    inHole?: GumboPlayerRef
    pitcher?: GumboPlayerRef
    battingOrder?: number
    team?: GumboPlayerRef
    first?: GumboPlayerRef
    second?: GumboPlayerRef
    third?: GumboPlayerRef
  }
  balls?: number
  strikes?: number
  outs?: number
}

export interface GumboInning {
  num: number
  ordinalNum: string
  home: GumboLinescoreTeam
  away: GumboLinescoreTeam
}

export interface GumboLinescoreTeam {
  runs?: number
  hits?: number
  errors?: number
  leftOnBase?: number
}

export interface GumboBoxscore {
  teams: {
    away: GumboBoxscoreTeam
    home: GumboBoxscoreTeam
  }
  officials: Array<{
    official: GumboPlayerRef
    officialType: string
  }>
  info: Array<{ label: string; value?: string }>
  pitchingNotes: string[]
  topPerformers?: Array<{
    player: GumboRosterPlayer
    type: string
    gameScore?: number
  }>
}

export interface GumboBoxscoreTeam {
  team: { id: number; name: string; link: string }
  teamStats: GumboTeamStats
  players: Record<string, GumboRosterPlayer>
  batters: number[]
  pitchers: number[]
  bench: number[]
  bullpen: number[]
  battingOrder: number[]
  info: GumboTeamInfo[]
  note: string[]
}

export interface GumboDecisions {
  winner: GumboPlayerRef
  loser: GumboPlayerRef
  save?: GumboPlayerRef
}

export interface GumboLeaders {
  hitDistance: unknown
  hitSpeed: unknown
  pitchSpeed: unknown
}

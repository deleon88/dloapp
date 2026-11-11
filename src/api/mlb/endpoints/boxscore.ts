import { mlbApi } from '../client'

interface RawBoxscorePlayer {
  person: { id: number; fullName: string }
  position: { abbreviation: string }
  allPositions?: Array<{ abbreviation?: string }>
  seasonStats: { batting: { avg?: string; obp?: string; ops?: string; plateAppearances?: number } }
  jerseyNumber?: string
  battingOrder?: string
}

interface RawBoxscoreTeam {
  battingOrder: number[]
  pitchers?: number[]
  players: Record<string, RawBoxscorePlayer>
}

interface RawBoxscoreResponse {
  teams: {
    away: RawBoxscoreTeam
    home: RawBoxscoreTeam
  }
}

export interface LineupSlot {
  id: number
  fullName: string
  pos: string
  avg: string
  obp: string
  pa: number | null
  jerseyNumber: string
}

export interface GameLineup {
  away: LineupSlot[]
  home: LineupSlot[]
  /** The starting pitcher, once the team hands in its lineup card (before the game). */
  awayStarter?: Starter
  homeStarter?: Starter
}

export interface Starter { id: number; fullName: string }

/** The team's starting pitcher: first in the boxscore's pitchers, listed once the lineup card is in (before the first pitch). */
function starter(team: { pitchers?: number[]; players: Record<string, { person: { id: number; fullName?: string } }> }): Starter | undefined {
  const id = team.pitchers?.[0]
  const p = id != null ? team.players[`ID${id}`] : undefined
  return p?.person.fullName ? { id: p.person.id, fullName: p.person.fullName } : undefined
}

const BOXSCORE_FIELDS = [
  'teams', 'away', 'home',
  'battingOrder', 'pitchers',
  'players', 'person', 'id', 'fullName',
  'position', 'allPositions', 'abbreviation',
  'seasonStats', 'batting', 'avg', 'obp', 'ops', 'plateAppearances',
  'jerseyNumber',
].join(',')

export async function getGameLineup(gamePk: number): Promise<GameLineup> {
  const data = await mlbApi.get<RawBoxscoreResponse>(`/game/${gamePk}/boxscore`, {
    fields: BOXSCORE_FIELDS,
  })
  return {
    away: buildLineup(data.teams.away),
    home: buildLineup(data.teams.home),
    awayStarter: starter(data.teams.away),
    homeStarter: starter(data.teams.home),
  }
}

/**
 * Starting batting order of a team. Uses team.players (not team.battingOrder)
 * because the battingOrder array only holds the *current* occupant of each
 * slot — substitutes replace the original starter once the game is under way.
 * Players with battingOrder "100","200",…,"900" are the starters; "101","201",… are subs.
 */
function starters<P extends { battingOrder?: string }>(players: Record<string, P>): P[] {
  return Object.values(players)
    .filter(p => p.battingOrder != null && parseInt(p.battingOrder) % 100 === 0)
    .sort((a, b) => parseInt(a.battingOrder!) - parseInt(b.battingOrder!))
}

/** Starting batting orders (player ids) of both teams, empty until confirmed, and the starting pitchers once the game is on. */
export async function getStartingBattingOrders(gamePk: number): Promise<{ away: number[]; home: number[]; awayStarter?: Starter; homeStarter?: Starter }> {
  const data = await mlbApi.get<{
    teams: Record<'away' | 'home', { pitchers?: number[]; players: Record<string, { person: { id: number; fullName?: string }; battingOrder?: string }> }>
  }>(`/game/${gamePk}/boxscore`, {
    fields: 'teams,away,home,pitchers,players,person,id,fullName,battingOrder',
  })
  return {
    away: starters(data.teams.away.players).map(p => p.person.id),
    home: starters(data.teams.home.players).map(p => p.person.id),
    awayStarter: starter(data.teams.away),
    homeStarter: starter(data.teams.home),
  }
}

/**
 * Where the player started: the first of allPositions. `position` is where
 * they finished (a LF who moved to RF mid-game would show as RF and leave LF
 * empty). A two-way player listed as P first takes their other position (DH).
 */
function startingPosition(p: RawBoxscorePlayer): string {
  const all = (p.allPositions ?? []).map(x => x.abbreviation ?? '').filter(Boolean)
  return all.find(x => x !== 'P') ?? all[0] ?? p.position.abbreviation
}

function buildLineup(team: RawBoxscoreTeam): LineupSlot[] {
  return starters(team.players)
    .map(p => {
      const b = p.seasonStats?.batting ?? {}
      return {
        id: p.person.id,
        fullName: p.person.fullName,
        pos: startingPosition(p),
        avg: b.avg ?? '.---',
        obp: b.obp ?? '.---',
        pa: b.plateAppearances ?? null,
        jerseyNumber: p.jerseyNumber ?? '',
      }
    })
}

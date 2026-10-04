import { mlbApi } from '../client'

interface RawBoxscorePlayer {
  person: { id: number; fullName: string }
  position: { abbreviation: string }
  seasonStats: { batting: { avg?: string; obp?: string; ops?: string; plateAppearances?: number } }
  jerseyNumber?: string
  battingOrder?: string
}

interface RawBoxscoreTeam {
  battingOrder: number[]
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
}

const BOXSCORE_FIELDS = [
  'teams', 'away', 'home',
  'battingOrder',
  'players', 'person', 'id', 'fullName',
  'position', 'abbreviation',
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

/** Starting batting orders (player ids) of both teams; empty until confirmed. */
export async function getStartingBattingOrders(gamePk: number): Promise<{ away: number[]; home: number[] }> {
  const data = await mlbApi.get<{
    teams: Record<'away' | 'home', { players: Record<string, { person: { id: number }; battingOrder?: string }> }>
  }>(`/game/${gamePk}/boxscore`, {
    fields: 'teams,away,home,players,person,id,battingOrder',
  })
  return {
    away: starters(data.teams.away.players).map(p => p.person.id),
    home: starters(data.teams.home.players).map(p => p.person.id),
  }
}

function buildLineup(team: RawBoxscoreTeam): LineupSlot[] {
  return starters(team.players)
    .map(p => {
      const b = p.seasonStats?.batting ?? {}
      return {
        id: p.person.id,
        fullName: p.person.fullName,
        pos: p.position.abbreviation,
        avg: b.avg ?? '.---',
        obp: b.obp ?? '.---',
        pa: b.plateAppearances ?? null,
        jerseyNumber: p.jerseyNumber ?? '',
      }
    })
}

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

function buildLineup(team: RawBoxscoreTeam): LineupSlot[] {
  // Iterate team.players (not team.battingOrder) because the battingOrder array only
  // holds the *current* occupant of each slot — substitutes replace the original starter.
  // Players with battingOrder "100","200",…,"900" are the starters; "101","201",… are subs.
  return Object.values(team.players)
    .filter(p => p.battingOrder != null && parseInt(p.battingOrder) % 100 === 0)
    .sort((a, b) => parseInt(a.battingOrder!) - parseInt(b.battingOrder!))
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

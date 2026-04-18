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
  return (team.battingOrder ?? []).map((id) => {
    const p = team.players[`ID${id}`]
    if (!p) return null
    const b = p.seasonStats?.batting ?? {}
    return {
      id,
      fullName: p.person.fullName,
      pos: p.position.abbreviation,
      avg: b.avg ?? '.---',
      obp: b.obp ?? '.---',
      pa: b.plateAppearances ?? null,
      jerseyNumber: p.jerseyNumber ?? '',
    }
  }).filter((s): s is LineupSlot => s !== null)
}

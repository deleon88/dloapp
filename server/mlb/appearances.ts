// What a game's official boxscore gives the pipeline, in one request:
//   - pitcher appearances: who pitched for each side, in what order, pitch counts;
//   - starting lineups: each side's batting order with the position played.
import { getJson } from './pbp.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const FIELDS = 'teams,away,home,team,id,pitchers,players,battingOrder,position,allPositions,abbreviation,' +
  'stats,pitching,numberOfPitches,battersFaced,outs,fielding,innings'

export interface AppearanceRow {
  game_pk: number
  pitcher_id: number
  team_id: number
  seq: number          // 0 = starter
  pitches: number
  batters_faced: number
  outs: number
}

export interface LineupRow {
  game_pk: number
  team_id: number
  spot: number         // 1-9
  player_id: number
  position: string
  innings: number      // innings in the field; a DH counts as 9
}

interface RawSide {
  team?: { id?: number }
  pitchers?: number[]
  players?: Record<string, {
    battingOrder?: string
    position?: { abbreviation?: string }
    allPositions?: Array<{ abbreviation?: string }>
    stats?: {
      pitching?: { numberOfPitches?: number; battersFaced?: number; outs?: number }
      fielding?: { innings?: string }
    }
  }>
}

type RawTeams = { away?: RawSide; home?: RawSide }

export function parseAppearances(gamePk: number, teams: RawTeams): AppearanceRow[] {
  const rows: AppearanceRow[] = []
  for (const side of [teams.away, teams.home]) {
    const teamId = side?.team?.id
    if (!teamId) continue
    ;(side.pitchers ?? []).forEach((pitcherId, seq) => {
      const p = side.players?.[`ID${pitcherId}`]?.stats?.pitching
      rows.push({
        game_pk: gamePk,
        pitcher_id: pitcherId,
        team_id: teamId,
        seq,
        pitches: p?.numberOfPitches ?? 0,
        batters_faced: p?.battersFaced ?? 0,
        outs: p?.outs ?? 0,
      })
    })
  }
  return rows
}

/**
 * Starting nine of each side. The team's `battingOrder` array holds whoever
 * ended the game in each spot (a pinch hitter can replace the starter), so the
 * starters come from each player's own `battingOrder`: "500" = started 5th,
 * "501" = first sub in that spot. Their position is the first one they played;
 * `innings` lets the predictor tell a full game there from a couple of innings.
 */
export function parseLineups(gamePk: number, teams: RawTeams): LineupRow[] {
  const rows: LineupRow[] = []
  for (const side of [teams.away, teams.home]) {
    const teamId = side?.team?.id
    if (!teamId) continue
    for (const [key, p] of Object.entries(side.players ?? {})) {
      const order = Number(p.battingOrder)
      if (!order || order % 100 !== 0 || order > 900) continue
      // A two-way player who pitches and hits (Ohtani) is listed as P first: they bat as the DH.
      const positions = (p.allPositions ?? []).map(x => x.abbreviation ?? '').filter(Boolean)
      const position = positions.find(x => x !== 'P') ?? (positions.length ? 'DH' : p.position?.abbreviation ?? '')
      if (!position) continue
      rows.push({
        game_pk: gamePk,
        team_id: teamId,
        spot: order / 100,
        player_id: Number(key.replace('ID', '')),
        position,
        innings: parseFloat(p.stats?.fielding?.innings ?? '') || 9,
      })
    }
  }
  return rows.sort((a, b) => a.team_id - b.team_id || a.spot - b.spot)
}

export async function fetchBoxscoreRows(gamePk: number): Promise<{ appearances: AppearanceRow[]; lineups: LineupRow[] }> {
  const data = await getJson<{ teams?: RawTeams }>(`${MLB_API}/game/${gamePk}/boxscore?fields=${FIELDS}`)
  const teams = data.teams ?? {}
  return { appearances: parseAppearances(gamePk, teams), lineups: parseLineups(gamePk, teams) }
}

export async function fetchAppearances(gamePk: number): Promise<AppearanceRow[]> {
  return (await fetchBoxscoreRows(gamePk)).appearances
}

// Pitcher appearances of a game from MLB's official boxscore: who pitched for
// each side, in what order, and their pitch counts.
import { getJson } from './pbp.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const FIELDS = 'teams,away,home,team,id,pitchers,players,stats,pitching,numberOfPitches,battersFaced,outs'

export interface AppearanceRow {
  game_pk: number
  pitcher_id: number
  team_id: number
  seq: number          // 0 = starter
  pitches: number
  batters_faced: number
  outs: number
}

interface RawSide {
  team?: { id?: number }
  pitchers?: number[]
  players?: Record<string, { stats?: { pitching?: { numberOfPitches?: number; battersFaced?: number; outs?: number } } }>
}

export function parseAppearances(gamePk: number, teams: { away?: RawSide; home?: RawSide }): AppearanceRow[] {
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

export async function fetchAppearances(gamePk: number): Promise<AppearanceRow[]> {
  const data = await getJson<{ teams?: { away?: RawSide; home?: RawSide } }>(
    `${MLB_API}/game/${gamePk}/boxscore?fields=${FIELDS}`,
  )
  return parseAppearances(gamePk, data.teams ?? {})
}

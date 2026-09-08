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
  pitchers: number[]
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
  // Current defensive alignment (9 fielders), distinct from away/home above
  // (the starting/current batting order) — see buildCurrentFielders for why
  // these need to be built separately once substitutions happen.
  awayFielders: LineupSlot[]
  homeFielders: LineupSlot[]
}

const BOXSCORE_FIELDS = [
  'teams', 'away', 'home',
  'battingOrder', 'pitchers',
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
    awayFielders: buildCurrentFielders(data.teams.away),
    homeFielders: buildCurrentFielders(data.teams.home),
  }
}

function toSlot(p: RawBoxscorePlayer): LineupSlot {
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
}

function buildLineup(team: RawBoxscoreTeam): LineupSlot[] {
  // Iterate team.players (not team.battingOrder) because the battingOrder array only
  // holds the *current* occupant of each slot — substitutes replace the original starter.
  // Players with battingOrder "100","200",…,"900" are the starters; "101","201",… are subs.
  // This is the STARTING lineup — intentionally stable across the whole game (shown in
  // the batting comparison table). For the fielding diamond's "who's out there right
  // now", see buildCurrentFielders below instead.
  return Object.values(team.players)
    .filter(p => p.battingOrder != null && parseInt(p.battingOrder) % 100 === 0)
    .sort((a, b) => parseInt(a.battingOrder!) - parseInt(b.battingOrder!))
    .map(toSlot)
}

/**
 * Current defensive alignment — built from team.battingOrder (the CURRENT
 * occupant of each of the 9 slots, substitutes included) rather than the
 * frozen starters buildLineup() uses.
 *
 * Why not just reuse buildLineup()'s starters for the diamond too: MLB's
 * per-player `position.abbreviation` reflects that player's own last-played
 * position, not "who's currently there" — once a starter is subbed out, their
 * stale position can (and empirically does, verified against live boxscores)
 * end up matching whichever player has since moved into that same spot,
 * silently overwriting them in the position→player map and leaving that
 * fielder missing from the diagram. The CURRENT occupants never collide like
 * this — only one player can occupy a given position at a time — so mapping
 * from `battingOrder` (not `players`) is what actually reflects live defense.
 *
 * Pitcher is added separately: with the DH, the pitcher never bats and so
 * never appears in `battingOrder` at all. `team.pitchers` lists every pitcher
 * used this game in order — the last one is the current (or, for a completed
 * game, the last to have pitched).
 */
function buildCurrentFielders(team: RawBoxscoreTeam): LineupSlot[] {
  const slots = team.battingOrder
    .map(id => team.players[`ID${id}`])
    .filter((p): p is RawBoxscorePlayer => p != null)
    .map(toSlot)

  if (!slots.some(s => s.pos === 'P')) {
    const currentPitcherId = team.pitchers[team.pitchers.length - 1]
    const pitcher = currentPitcherId != null ? team.players[`ID${currentPitcherId}`] : undefined
    if (pitcher) slots.push(toSlot(pitcher))
  }

  return slots
}

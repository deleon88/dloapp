// What the leaderboards need from the MLB Stats API, one bulk call each: the
// player directory (name, position, team) and the numbers the stored
// play-by-play can't give — runs and steals (they happen outside a PA's
// result), and ERA / W-L / saves (earned runs and decisions).
import { getJson } from '../mlb/pbp.js'
import { LEAGUES, leagueParams, leagueTeamStatsParams, type League } from '../leagues.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

export type Role = 'all' | 'sp' | 'rp'

export interface DirectoryEntry {
  name: string
  pos: string            // primary position abbreviation (P, C, 1B, … DH, TWP)
  teamId: number | null  // current team
  throws: string | null
}

const DIRECTORY_TTL = 6 * 3_600_000
const directoryCache = new Map<string, { at: number; data: Promise<Map<number, DirectoryEntry>> }>()

/**
 * Every player of the league's sport in the season (≈1500), cached a few hours
 * per server instance. Winter leagues share one list (sportId 17); the team
 * of each row comes from the play-by-play, not from here.
 */
export function getPlayerDirectory(league: League, season: number): Promise<Map<number, DirectoryEntry>> {
  const { sportId } = LEAGUES[league]
  const key = `${sportId}-${season}`
  const hit = directoryCache.get(key)
  if (hit && Date.now() - hit.at < DIRECTORY_TTL) return hit.data
  const data = getJson<{ people?: Array<{ id: number; fullName: string; currentTeam?: { id: number }; primaryPosition?: { abbreviation?: string }; pitchHand?: { code?: string } }> }>(
    `${MLB_API}/sports/${sportId}/players?season=${season}&fields=people,id,fullName,primaryPosition,abbreviation,currentTeam,pitchHand,code`,
  ).then(d => new Map((d.people ?? []).map(p => [p.id, {
    name: p.fullName,
    pos: p.primaryPosition?.abbreviation ?? '',
    teamId: p.currentTeam?.id ?? null,
    throws: p.pitchHand?.code ?? null,
  }])))
  data.catch(() => directoryCache.delete(key))
  directoryCache.set(key, { at: Date.now(), data })
  return data
}

type Range = { league: League; season: number; from?: string; to?: string }

/** stats= / dates part of a bulk query: the season, or a date window. */
function statsQuery({ league, season, from, to }: Range): string {
  const end = league === 'MLB' ? `${season}-12-31` : `${season + 1}-02-28`
  return from || to
    ? `stats=byDateRange&startDate=${from ?? `${season}-01-01`}&endDate=${to ?? end}`
    : 'stats=season'
}

type Splits<K extends string> = { stats?: Array<{ splits?: Array<{ stat: Record<string, unknown> } & Record<K, { id: number }>> }> }

const num = (v: unknown) => (typeof v === 'number' ? v : null)

export interface HittingExtras { r: number | null; sb: number | null; cs: number | null }

/** Runs, steals and caught stealing of every hitter, for the season or a window. */
export async function getHittingExtras(r: Range): Promise<Map<number, HittingExtras>> {
  const d = await getJson<Splits<'player'>>(
    `${MLB_API}/stats?${statsQuery(r)}&group=hitting&season=${r.season}&playerPool=ALL&limit=4000&${leagueParams(r.league)}&gameType=R` +
    '&fields=stats,splits,player,id,stat,runs,stolenBases,caughtStealing',
  )
  return new Map((d.stats?.[0]?.splits ?? []).map(s => [s.player.id, {
    r: num(s.stat.runs), sb: num(s.stat.stolenBases), cs: num(s.stat.caughtStealing),
  }]))
}

export interface PitchingRecord {
  era: number | null
  w: number | null
  l: number | null
  sv: number | null
  hld: number | null
}

const PITCHING_FIELDS = '&fields=stats,splits,player,team,id,stat,era,wins,losses,saves,holds'

function toRecord(stat: Record<string, unknown>): PitchingRecord {
  const era = typeof stat.era === 'string' ? Number(stat.era) : NaN
  return { era: Number.isFinite(era) ? era : null, w: num(stat.wins), l: num(stat.losses), sv: num(stat.saves), hld: num(stat.holds) }
}

/**
 * ERA, W-L, saves and holds of every pitcher. A role (as starter / as reliever)
 * comes from MLB's sp / rp splits, which exist for the whole season only: with
 * a role and a date window together there's no answer (null).
 */
export async function getPitchingRecords(r: Range & { role: Role }): Promise<Map<number, PitchingRecord> | null> {
  const windowed = !!(r.from || r.to)
  if (r.role !== 'all' && windowed) return null
  const query = r.role === 'all' ? statsQuery(r) : `stats=statSplits&sitCodes=${r.role}`
  const d = await getJson<Splits<'player'>>(
    `${MLB_API}/stats?${query}&group=pitching&season=${r.season}&playerPool=ALL&limit=4000&${leagueParams(r.league)}&gameType=R${PITCHING_FIELDS}`,
  )
  return new Map((d.stats?.[0]?.splits ?? []).map(s => [s.player.id, toRecord(s.stat)]))
}

export interface TeamExtras { era: number | null; w: number | null; l: number | null; sb: number | null }

/** Team ERA and W-L (by role when asked, season only) plus steals. */
export async function getTeamExtras(r: Range & { role: Role }): Promise<Map<number, TeamExtras>> {
  const windowed = !!(r.from || r.to)
  const base = `&season=${r.season}&${leagueTeamStatsParams(r.league)}&gameType=R`
  const pitchQuery = r.role === 'all' ? statsQuery(r) : windowed ? null : `stats=statSplits&sitCodes=${r.role}`
  const [pit, hit] = await Promise.all([
    pitchQuery
      ? getJson<Splits<'team'>>(`${MLB_API}/teams/stats?${pitchQuery}&group=pitching${base}${PITCHING_FIELDS}`)
      : Promise.resolve(null),
    getJson<Splits<'team'>>(`${MLB_API}/teams/stats?${statsQuery(r)}&group=hitting${base}&fields=stats,splits,team,id,stat,stolenBases`),
  ])
  const out = new Map<number, TeamExtras>()
  for (const s of pit?.stats?.[0]?.splits ?? []) {
    const rec = toRecord(s.stat)
    out.set(s.team.id, { era: rec.era, w: r.role === 'all' ? rec.w : null, l: r.role === 'all' ? rec.l : null, sb: null })
  }
  for (const s of hit.stats?.[0]?.splits ?? []) {
    const cur = out.get(s.team.id) ?? { era: null, w: null, l: null, sb: null }
    out.set(s.team.id, { ...cur, sb: num(s.stat.stolenBases) })
  }
  return out
}

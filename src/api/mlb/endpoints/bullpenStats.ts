import { mlbApi } from '../client'

export interface BullpenPitcher {
  id: number
  name: string
  hand: string
  // sabermetrics (RP-filtered via sitCodes=rp)
  fip: number | null
  xfip: number | null
  fipMinus: number | null
  eraMinus: number | null
  war: number | null
  pli: number | null
  // full-season stats from /people
  era: string | null
  whip: string | null
  ip: string | null
  k9: string | null
  saves: number
  holds: number
  blownSaves: number
  strandRate: number | null
}

export interface BullpenStats {
  pitchers: BullpenPitcher[]
  teamFipMinus: number | null
  teamEra: string | null
  teamWhip: string | null
}

interface TeamStatSplit {
  player: { id: number; fullName: string }
  stat: Record<string, unknown>
}

interface TeamStatResponse {
  stats: Array<{ splits: TeamStatSplit[] }>
}

interface RosterEntry {
  person: { id: number }
  position: { type: string; abbreviation: string }
  status: { code: string }
}

interface StatEntry {
  type: { displayName: string }
  splits: Array<{ stat: Record<string, unknown> }>
}

interface RawPerson {
  id: number
  fullName: string
  pitchHand?: { code: string }
  stats?: StatEntry[]
}

function ipToDecimal(ip: string | null | undefined): number {
  if (!ip) return 0
  const [whole, thirds] = ip.split('.').map(Number)
  return (whole ?? 0) + ((thirds ?? 0) / 3)
}

/**
 * Full bullpen stats for the game-view BullpenCard.
 * Uses RP-filtered sabermetrics (FIP-/pLI) + /people for per-pitcher season stats (IP/ERA/WHIP).
 */
export async function fetchBullpenStats(teamId: number): Promise<BullpenStats> {
  const season = new Date().getFullYear()
  const base = { group: 'pitching', season, sportIds: 1, gameType: 'R', sitCodes: 'rp' }

  // Parallel: active roster (position filter) + sabermetrics per pitcher
  const [rosterData, saberRes] = await Promise.all([
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'active',
      season,
      fields: 'roster,person,id,position,type,abbreviation,status,code',
    }),
    mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' }),
  ])

  // Include pitchers and two-way players; exclude position players pitching in emergencies
  const pitcherIdSet = new Set<number>(
    (rosterData.roster ?? [])
      .filter(e =>
        e.status.code === 'A' &&
        (e.position.type === 'Pitcher' || e.position.abbreviation === 'TWP'),
      )
      .map(e => e.person.id),
  )

  const saberSplits = (saberRes.stats?.[0]?.splits ?? []).filter(s => pitcherIdSet.has(s.player.id))
  const playerIds = saberSplits.map(s => s.player.id)

  if (!playerIds.length) return { pitchers: [], teamFipMinus: null, teamEra: null, teamWhip: null }

  // /people gives per-pitcher season stats (IP, ERA, WHIP, saves, inheritedRunners, etc.) + handedness
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: playerIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[season],season=${season})`,
    fields: [
      'people', 'id', 'fullName', 'pitchHand', 'code',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'era', 'whip', 'inningsPitched', 'strikeoutsPer9Inn',
      'saves', 'holds', 'blownSaves',
      'inheritedRunners', 'inheritedRunnersScored',
    ].join(','),
  })

  // inheritedRunners lives in the season stat (not seasonAdvanced)
  type SeasonStat = {
    era?: string; whip?: string; inningsPitched?: string; strikeoutsPer9Inn?: string
    saves?: number; holds?: number; blownSaves?: number
    inheritedRunners?: number; inheritedRunnersScored?: number
  }
  type PersonInfo = { fullName: string; hand: string; season: SeasonStat }

  const personMap = new Map<number, PersonInfo>()
  for (const p of peopleData.people ?? []) {
    const byType = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
    personMap.set(p.id, {
      fullName: p.fullName,
      hand:     p.pitchHand?.code ?? '?',
      season:   byType.get('season') as SeasonStat ?? {},
    })
  }

  const pitchers: BullpenPitcher[] = []

  for (const saber of saberSplits) {
    const person = personMap.get(saber.player.id)
    if (!person) continue

    const s  = saber.stat as { fip?: number; xfip?: number; fipMinus?: number; eraMinus?: number; war?: number; pli?: number }
    const ss = person.season

    const ip = ss.inningsPitched ?? null
    if (ipToDecimal(ip) === 0) continue

    const ir  = ss.inheritedRunners       ?? 0
    const irs = ss.inheritedRunnersScored ?? 0

    pitchers.push({
      id:         saber.player.id,
      name:       person.fullName,
      hand:       person.hand,
      fip:        s.fip        ?? null,
      xfip:       s.xfip       ?? null,
      fipMinus:   s.fipMinus   ?? null,
      eraMinus:   s.eraMinus   ?? null,
      war:        s.war        ?? null,
      pli:        s.pli        ?? null,
      era:        ss.era       ?? null,
      whip:       ss.whip      ?? null,
      ip,
      k9:         ss.strikeoutsPer9Inn ?? null,
      saves:      ss.saves      ?? 0,
      holds:      ss.holds      ?? 0,
      blownSaves: ss.blownSaves ?? 0,
      strandRate: ir > 0 ? Math.round((1 - irs / ir) * 100) : null,
    })
  }

  pitchers.sort((a, b) => {
    if (a.fipMinus == null && b.fipMinus == null) return 0
    if (a.fipMinus == null) return 1
    if (b.fipMinus == null) return -1
    return a.fipMinus - b.fipMinus
  })

  const totalIP = pitchers.reduce((s, p) => s + ipToDecimal(p.ip), 0)
  let teamFipMinus: number | null = null
  let teamEra: string | null = null
  let teamWhip: string | null = null

  if (totalIP > 0) {
    const withFip = pitchers.filter(p => p.fipMinus != null)
    const fipIP   = withFip.reduce((s, p) => s + ipToDecimal(p.ip), 0)
    if (fipIP > 0) {
      teamFipMinus = Math.round(
        withFip.reduce((s, p) => s + p.fipMinus! * ipToDecimal(p.ip), 0) / fipIP,
      )
    }
    teamEra = (
      pitchers.reduce((s, p) => s + parseFloat(p.era ?? '0') * ipToDecimal(p.ip), 0) / totalIP
    ).toFixed(2)
    teamWhip = (
      pitchers.reduce((s, p) => s + parseFloat(p.whip ?? '0') * ipToDecimal(p.ip), 0) / totalIP
    ).toFixed(2)
  }

  return { pitchers, teamFipMinus, teamEra, teamWhip }
}

/**
 * Lightweight batch fetch for the schedule-page bullpen bar.
 * Step 1: sabermetrics per pitcher for each team (parallel).
 * Step 2: one bulk /people call for all pitchers → IP for weighting.
 * Returns Map<teamId, fipPlus> where fipPlus = 200 - IP-weighted FIP-.
 */
export async function fetchBullpenFipPlusMap(teamIds: number[]): Promise<Map<number, number>> {
  if (!teamIds.length) return new Map()

  const season = new Date().getFullYear()
  const base = { group: 'pitching', season, sportIds: 1, gameType: 'R', sitCodes: 'rp' }

  // Step 1: sabermetrics for all teams in parallel
  const saberResults = await Promise.all(
    teamIds.map(teamId =>
      mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' })
        .then(res => ({ teamId, splits: res.stats?.[0]?.splits ?? [] })),
    ),
  )

  // Collect all unique player IDs across all teams
  const allPlayerIds = [...new Set(saberResults.flatMap(r => r.splits.map(s => s.player.id)))]
  if (!allPlayerIds.length) return new Map()

  // Step 2: one bulk /people call for IP of every pitcher
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: allPlayerIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[season],season=${season})`,
    fields: 'people,id,stats,type,displayName,splits,stat,inningsPitched',
  })

  const ipMap = new Map<number, number>()
  for (const p of peopleData.people ?? []) {
    const stat = (p.stats ?? [])
      .find(s => s.type.displayName === 'season')
      ?.splits?.[0]?.stat as { inningsPitched?: string } | undefined
    const ipDec = ipToDecimal(stat?.inningsPitched)
    if (ipDec > 0) ipMap.set(p.id, ipDec)
  }

  // Step 3: IP-weighted FIP- per team → FIP+
  const map = new Map<number, number>()
  for (const { teamId, splits } of saberResults) {
    const pitchers = splits
      .map(s => ({
        fipMinus: s.stat.fipMinus as number | undefined,
        ipDec:    ipMap.get(s.player.id) ?? 0,
      }))
      .filter((p): p is { fipMinus: number; ipDec: number } => p.fipMinus != null && p.ipDec > 0)

    const totalIP = pitchers.reduce((s, p) => s + p.ipDec, 0)
    if (totalIP === 0) continue

    const teamFipMinus = pitchers.reduce((s, p) => s + p.fipMinus * p.ipDec, 0) / totalIP
    map.set(teamId, Math.round(200 - teamFipMinus))
  }

  return map
}

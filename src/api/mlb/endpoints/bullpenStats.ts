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
  gmli: number | null
  // RP-only stats from /people
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

  // Parallel: depth chart (RP/CP only) + sabermetrics per pitcher
  const [rosterData, saberRes] = await Promise.all([
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'depthChart',
      season,
      fields: 'roster,person,id,position,type,abbreviation,status,code',
    }),
    mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' }),
  ])

  // P = reliever, CP = closer — exclude SP (starters) and position players
  const pitcherIdSet = new Set<number>(
    (rosterData.roster ?? [])
      .filter(e =>
        e.status.code === 'A' &&
        (e.position.abbreviation === 'P' || e.position.abbreviation === 'CP'),
      )
      .map(e => e.person.id),
  )

  const saberSplits = (saberRes.stats?.[0]?.splits ?? []).filter(s => pitcherIdSet.has(s.player.id))
  const playerIds = saberSplits.map(s => s.player.id)

  if (!playerIds.length) return { pitchers: [], teamFipMinus: null, teamEra: null, teamWhip: null }

  // /people with sitCodes=[rp] gives RP-only stats (IP, ERA, WHIP, saves, etc.) + handedness
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: playerIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`,
    fields: [
      'people', 'id', 'fullName', 'pitchHand', 'code',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'era', 'whip', 'inningsPitched', 'strikeoutsPer9Inn',
      'saves', 'holds', 'blownSaves',
      'inheritedRunners', 'inheritedRunnersScored',
    ].join(','),
  })

  type RpStat = {
    era?: string; whip?: string; inningsPitched?: string; strikeoutsPer9Inn?: string
    saves?: number; holds?: number; blownSaves?: number
    inheritedRunners?: number; inheritedRunnersScored?: number
  }
  type PersonInfo = { fullName: string; hand: string; rp: RpStat }

  const personMap = new Map<number, PersonInfo>()
  for (const p of peopleData.people ?? []) {
    const byType = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
    personMap.set(p.id, {
      fullName: p.fullName,
      hand:     p.pitchHand?.code ?? '?',
      rp:       byType.get('statSplits') as RpStat ?? {},
    })
  }

  const pitchers: BullpenPitcher[] = []

  for (const saber of saberSplits) {
    const person = personMap.get(saber.player.id)
    if (!person) continue

    const s  = saber.stat as { fip?: number; xfip?: number; fipMinus?: number; eraMinus?: number; war?: number; pli?: number; gmli?: number }
    const ss = person.rp

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
      gmli:       s.gmli       ?? null,
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

  // Sort by gmLI descending — closers/setup men first, long relievers last
  pitchers.sort((a, b) => {
    if (a.gmli == null && b.gmli == null) return 0
    if (a.gmli == null) return 1
    if (b.gmli == null) return -1
    return b.gmli - a.gmli
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

  // Step 1: depth chart + sabermetrics for all teams in parallel
  const rawResults = await Promise.all(
    teamIds.map(teamId =>
      Promise.all([
        mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
          rosterType: 'depthChart',
          season,
          fields: 'roster,person,id,position,abbreviation,status,code',
        }),
        mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' }),
      ]).then(([rosterRes, saberRes]) => {
        const relieverIds = new Set<number>(
          (rosterRes.roster ?? [])
            .filter(e =>
              e.status.code === 'A' &&
              (e.position.abbreviation === 'P' || e.position.abbreviation === 'CP'),
            )
            .map(e => e.person.id),
        )
        const splits = (saberRes.stats?.[0]?.splits ?? []).filter(s => relieverIds.has(s.player.id))
        return { teamId, splits }
      }),
    ),
  )
  const saberResults = rawResults

  // Collect all unique player IDs across all teams
  const allPlayerIds = [...new Set(saberResults.flatMap(r => r.splits.map(s => s.player.id)))]
  if (!allPlayerIds.length) return new Map()

  // Step 2: one bulk /people call for RP-only IP of every pitcher
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: allPlayerIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`,
    fields: 'people,id,stats,type,displayName,splits,stat,inningsPitched',
  })

  const ipMap = new Map<number, number>()
  for (const p of peopleData.people ?? []) {
    const stat = (p.stats ?? [])
      .find(s => s.type.displayName === 'statSplits')
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

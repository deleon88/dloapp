import { mlbApi } from '../client'
import { fetchPitcherLines, type PitcherLine, type PitcherSplit } from '@/api/stats/pitchers'
import type { StatPeriod } from '@/utils/period'

export interface BullpenPitcher {
  id: number
  name: string
  hand: string
  fip: number | null
  xfip: number | null
  fipMinus: number | null
  eraMinus: number | null
  war: number | null
  pli: number | null
  gmli: number | null
  era: string | null
  whip: string | null
  ip: string | null
  k9: string | null
  saves: number
  holds: number
  blownSaves: number
  strandRate: number | null
}

export interface BullpenUsage {
  days: Array<{ gamePk: number; date: string; label: string }>
  /** Pitches per game for each listed pitcher (by id), same order as days. */
  pitches: Record<string, number[]>
}

export interface BullpenStats {
  pitchers: BullpenPitcher[]
  teamFipMinus: number | null
  teamEra: string | null
  teamWhip: string | null
  usage?: BullpenUsage
}

type BullpenHand = 'all' | 'L' | 'R'

/**
 * Bullpen card of the game page, computed by the server (/api/bullpen, see
 * server/bullpen/bullpen.ts): the top-8 arms most likely to pitch today, their
 * relief numbers for the period / batter hand, team totals and the recent
 * pitch-count strip.
 */
export async function fetchBullpenStats(
  teamId: number,
  period: StatPeriod = 'season',
  hand: BullpenHand = 'all',
): Promise<BullpenStats> {
  const params = new URLSearchParams({ team: String(teamId) })
  if (period !== 'season') params.set('period', period)
  if (hand !== 'all') params.set('hand', hand)
  const res = await fetch(`/api/bullpen?${params}`)
  if (!res.ok) throw new Error(`bullpen ${res.status}`)
  return res.json() as Promise<BullpenStats>
}

// ── Schedule page: team bullpen FIP+ only (still computed here) ─────────────

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
  status: { code: string; description?: string }
}

interface RawPerson {
  id: number
  stats?: Array<{ type: { displayName: string }; splits: Array<{ stat: Record<string, unknown> }> }>
}

function ipToDecimal(ip: string | null | undefined): number {
  if (!ip) return 0
  const [whole, thirds] = ip.split('.').map(Number)
  return (whole ?? 0) + ((thirds ?? 0) / 3)
}

function pickSplit(line: PitcherLine | undefined, hand: BullpenHand): PitcherSplit | undefined {
  if (!line) return undefined
  return hand === 'L' ? line.vsL : hand === 'R' ? line.vsR : line
}

/**
 * Lightweight batch fetch for the schedule-page bullpen bar.
 * Step 1: active relievers on each team's depth chart (+ MLB sabermetrics).
 * Step 2: their relief lines from our backend for the period / batter hand.
 * Returns Map<teamId, fipPlus> where fipPlus = 200 - IP-weighted FIP-.
 * If our backend fails in full season with no hand filter, falls back to MLB.
 */
export async function fetchBullpenFipPlusMap(
  teamIds: number[],
  period: StatPeriod = 'season',
  hand: BullpenHand = 'all',
): Promise<Map<number, number>> {
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
        return { teamId, splits, relieverIds: [...relieverIds] }
      }),
    ),
  )
  const saberResults = rawResults

  // Step 2: our relief lines for every active reliever, by period and hand
  const ours = await fetchPitcherLines(
    [...new Set(rawResults.flatMap(r => r.relieverIds))], { season, period, role: 'rp' },
  ).catch(() => null)
  if (ours) {
    const map = new Map<number, number>()
    for (const { teamId, relieverIds } of rawResults) {
      let ip = 0, fip = 0
      for (const id of relieverIds) {
        const s = pickSplit(ours.get(id), hand)
        if (!s || s.ip <= 0 || s.fipMinus == null) continue
        ip += s.ip
        fip += s.fipMinus * s.ip
      }
      if (ip > 0) map.set(teamId, Math.round(200 - fip / ip))
    }
    return map
  }
  if (period !== 'season' || hand !== 'all') return new Map()

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

import { mlbApi } from '../client'
import { fetchPitcherLines, formatIp, type PitcherLine, type PitcherSplit } from '@/api/stats/pitchers'
import type { StatPeriod } from '@/utils/period'
import { etDate } from '@/utils/etDate'

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
  status: { code: string; description?: string }
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

interface BoxscoreTeamSide {
  team: { id: number }
  pitchers: number[]
  players: Record<string, { stats: { pitching: { numberOfPitches?: number } } }>
}

interface UsageEntry { date: string; pitches: number; isStarter: boolean }

function _daysBetween(d1: string, d2: string): number {
  return Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000)
}

function _restScore(d: number): number {
  if (d >= 99) return 0
  if (d === 2)  return 20
  if (d === 3)  return 18
  if (d === 1)  return 12
  if (d === 4)  return 10
  return 5
}

function ipToDecimal(ip: string | null | undefined): number {
  if (!ip) return 0
  const [whole, thirds] = ip.split('.').map(Number)
  return (whole ?? 0) + ((thirds ?? 0) / 3)
}

/**
 * Full bullpen stats for the game-view BullpenCard.
 * Returns the top-8 most likely to pitch today, ranked by prediction score
 * (pLI + recent frequency + rest + closer role + DC order).
 * Excludes IL players, bulk starters, and pitch-gated arms.
 * Team aggregate FIP- is computed across all active DC arms for the totals row.
 */
export async function fetchBullpenStats(
  teamId: number,
  period: StatPeriod = 'season',
  hand: BullpenHand = 'all',
): Promise<BullpenStats> {
  // ET calendar days, like MLB's officialDate (UTC would put night games on the next day).
  const season       = new Date().getFullYear()
  const today        = etDate()
  const yesterday    = etDate(1)
  const twoDaysAgo   = etDate(2)
  const sevenDaysAgo = etDate(8)
  const base = { group: 'pitching', season, sportIds: 1, gameType: 'R', sitCodes: 'rp' }

  // ── Step 1: parallel fetches ───────────────────────────────────
  const [dcRes, frRes, saberRes, schedRes] = await Promise.all([
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'depthChart', season,
      fields: 'roster,person,id,position,type,abbreviation,status,code',
    }),
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'fullRoster', season,
      fields: 'roster,person,id,status,description',
    }),
    mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' }),
    mlbApi.get<{ dates: Array<{ games: Array<{ gamePk: number; officialDate: string; status: { abstractGameState: string } }> }> }>(
      '/schedule', {
        sportId: 1, teamId,
        startDate: sevenDaysAgo, endDate: today,
        fields: 'dates,games,gamePk,officialDate,status,abstractGameState',
      },
    ),
  ])

  // ── Step 2: IL set ─────────────────────────────────────────────
  const ilSet = new Set<number>()
  for (const r of frRes.roster ?? []) {
    const s = r.status?.description ?? ''
    if (s.startsWith('Injured') || s === 'Injured - Full Season') ilSet.add(r.person.id)
  }

  // ── Step 3: DC sets — depth chart uses 'P' for non-closers ────
  const isCloser = new Set<number>()
  const isRP     = new Set<number>()
  const dcOrder: Record<number, number> = {}
  let rpIdx = 0
  for (const r of dcRes.roster ?? []) {
    if (r.status.code !== 'A') continue
    const pid  = r.person.id
    const abbr = r.position?.abbreviation
    const type = r.position?.type
    if (abbr === 'CP') { isCloser.add(pid); isRP.add(pid); dcOrder[pid] = rpIdx++ }
    else if (type === 'Pitcher' && abbr !== 'SP') { isRP.add(pid); dcOrder[pid] = rpIdx++ }
  }

  // ── Step 4: pLI from sabermetrics ─────────────────────────────
  const pliMap = new Map<number, number>()
  const saberByPid = new Map<number, Record<string, unknown>>()
  for (const sp of saberRes.stats?.[0]?.splits ?? []) {
    pliMap.set(sp.player.id, (sp.stat as { pli?: number }).pli ?? 0)
    saberByPid.set(sp.player.id, sp.stat)
  }

  // ── Step 5: last-7-game boxscores for usage ────────────────────
  const completed = (schedRes.dates ?? [])
    .flatMap(d => d.games)
    .filter(g => g.status.abstractGameState === 'Final' && g.officialDate < today)
    .slice(-7)

  const usageMap = new Map<number, UsageEntry[]>()
  if (completed.length) {
    const boxes = await Promise.all(
      completed.map(g =>
        mlbApi.get<{ teams: { away: BoxscoreTeamSide; home: BoxscoreTeamSide } }>(
          `/game/${g.gamePk}/boxscore`,
          { fields: 'teams,away,home,team,id,pitchers,players,stats,pitching,numberOfPitches' },
        ).catch(() => null),
      ),
    )
    boxes.forEach((bs, i) => {
      if (!bs) return
      const gameDate = completed[i].officialDate
      const side = bs.teams.away.team.id === teamId ? bs.teams.away : bs.teams.home
      ;(side.pitchers ?? []).forEach((pid, order) => {
        const pitches = side.players?.['ID' + pid]?.stats?.pitching?.numberOfPitches ?? 0
        if (!usageMap.has(pid)) usageMap.set(pid, [])
        usageMap.get(pid)!.push({ date: gameDate, pitches, isStarter: order === 0 })
      })
    })
  }

  const gamesPlayed = completed.length

  // ── Step 6: score every candidate ─────────────────────────────
  const candidates = new Set<number>([...isRP])
  for (const [pid, apps] of usageMap)
    if (apps.some(a => !a.isStarter)) candidates.add(pid)

  const scoreMap = new Map<number, number>()
  for (const pid of candidates) {
    if (ilSet.has(pid)) continue
    const apps   = usageMap.get(pid) ?? []
    const rpApps = apps.filter(a => !a.isStarter)
    if (!rpApps.length && !isRP.has(pid)) continue
    if (apps.length && apps.every(a => a.isStarter)) continue
    // Exclude bulk starters appearing as relievers (avg relief > 50p)
    if (rpApps.length > 0 && rpApps.reduce((s, a) => s + a.pitches, 0) / rpApps.length > 50) continue

    const lastDate         = apps[apps.length - 1]?.date ?? null
    const daysRest         = lastDate ? _daysBetween(lastDate, today) : 99
    const pitchesYesterday = apps.filter(a => a.date === yesterday).reduce((s, a) => s + a.pitches, 0)
    const pitchesLast2     = apps.filter(a => a.date >= twoDaysAgo).reduce((s, a) => s + a.pitches, 0)
    // Pitch gate: 30p yesterday (raised from 25) / 50p over 2 days
    if (pitchesYesterday > 30 || pitchesLast2 >= 50) continue

    const pli      = pliMap.get(pid) ?? 0
    const appFreq  = gamesPlayed > 0 ? rpApps.length / gamesPlayed : 0
    const dcBonus  = isRP.has(pid) ? Math.max(0, 10 - (dcOrder[pid] ?? 10) * 0.8) : 0
    const score    = Math.min(pli * 30, 40) + appFreq * 25 + _restScore(daysRest) +
                     (isCloser.has(pid) ? 15 : 0) + dcBonus
    scoreMap.set(pid, score)
  }

  // Top 8 by prediction score
  const top8 = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id]) => id)

  if (!top8.length) return { pitchers: [], teamFipMinus: null, teamEra: null, teamWhip: null }

  // ── Step 7: /people for RP-only ERA/IP/WHIP/saves ─────────────
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: top8.join(','),
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
  const personMap = new Map<number, { fullName: string; hand: string; rp: RpStat }>()
  for (const p of peopleData.people ?? []) {
    const byType = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
    personMap.set(p.id, {
      fullName: p.fullName,
      hand:     p.pitchHand?.code ?? '?',
      rp:       byType.get('statSplits') as RpStat ?? {},
    })
  }

  // ── Step 8: build pitcher list in score order ──────────────────
  const pitchers: BullpenPitcher[] = []
  for (const pid of top8) {
    const person = personMap.get(pid)
    const s      = saberByPid.get(pid) as { fip?: number; xfip?: number; fipMinus?: number; eraMinus?: number; war?: number; pli?: number; gmli?: number } | undefined
    const ss     = person?.rp ?? {}
    const ir     = (ss as RpStat).inheritedRunners       ?? 0
    const irs    = (ss as RpStat).inheritedRunnersScored ?? 0

    pitchers.push({
      id:         pid,
      name:       person?.fullName ?? `ID${pid}`,
      hand:       person?.hand     ?? '?',
      fip:        s?.fip        ?? null,
      xfip:       s?.xfip       ?? null,
      fipMinus:   s?.fipMinus   ?? null,
      eraMinus:   s?.eraMinus   ?? null,
      war:        s?.war        ?? null,
      pli:        s?.pli        ?? null,
      gmli:       s?.gmli       ?? null,
      era:        (ss as RpStat).era                    ?? null,
      whip:       (ss as RpStat).whip                   ?? null,
      ip:         (ss as RpStat).inningsPitched         ?? null,
      k9:         (ss as RpStat).strikeoutsPer9Inn      ?? null,
      saves:      (ss as RpStat).saves      ?? 0,
      holds:      (ss as RpStat).holds      ?? 0,
      blownSaves: (ss as RpStat).blownSaves ?? 0,
      strandRate: ir > 0 ? Math.round((1 - irs / ir) * 100) : null,
    })
  }

  // ── Step 9: team aggregates from all active DC arms ────────────
  // Use full sabermetrics set (not just top-8) for accurate team FIP-
  const allDcIds = [...isRP].filter(id => !ilSet.has(id))
  const allDcPeopleData = allDcIds.length
    ? await mlbApi.get<{ people: RawPerson[] }>('/people', {
        personIds: allDcIds.join(','),
        season,
        hydrate: `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`,
        fields: 'people,id,stats,type,displayName,splits,stat,era,whip,inningsPitched',
      })
    : { people: [] }

  type AggEntry = { fipMinus: number | null; ip: number; era: number; whip: number }
  const aggEntries: AggEntry[] = []
  for (const p of allDcPeopleData.people ?? []) {
    const byType  = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
    const rpStat  = byType.get('statSplits') as { inningsPitched?: string; era?: string; whip?: string } ?? {}
    const ip      = ipToDecimal(rpStat.inningsPitched)
    if (ip === 0) continue
    const saber   = saberByPid.get(p.id) as { fipMinus?: number } | undefined
    aggEntries.push({
      fipMinus: saber?.fipMinus ?? null,
      ip,
      era:  parseFloat(rpStat.era  ?? '0'),
      whip: parseFloat(rpStat.whip ?? '0'),
    })
  }

  const totalIP = aggEntries.reduce((s, e) => s + e.ip, 0)
  let teamFipMinus: number | null = null
  let teamEra: string | null = null
  let teamWhip: string | null = null

  if (totalIP > 0) {
    const withFip = aggEntries.filter(e => e.fipMinus != null) as Array<AggEntry & { fipMinus: number }>
    const fipIP   = withFip.reduce((s, e) => s + e.ip, 0)
    if (fipIP > 0)
      teamFipMinus = Math.round(withFip.reduce((s, e) => s + e.fipMinus * e.ip, 0) / fipIP)
    teamEra  = (aggEntries.reduce((s, e) => s + e.era  * e.ip, 0) / totalIP).toFixed(2)
    teamWhip = (aggEntries.reduce((s, e) => s + e.whip * e.ip, 0) / totalIP).toFixed(2)
  }

  // ── Step 10: period / hand-aware numbers from our backend ──────
  // The arms above are chosen with season-wide MLB data (who's likely to pitch
  // today); the numbers shown for them follow the period and hand filter.
  const mlbOnly: BullpenStats = { pitchers, teamFipMinus, teamEra, teamWhip }
  const ours = await fetchPitcherLines([...new Set([...top8, ...allDcIds])], { season, period, role: 'rp' }).catch(() => null)
  if (!ours) return period === 'season' && hand === 'all' ? mlbOnly : withoutNumbers(mlbOnly)
  return withOurNumbers(mlbOnly, allDcIds, ours, period, hand)
}

type BullpenHand = 'all' | 'L' | 'R'

function pickSplit(line: PitcherLine | undefined, hand: BullpenHand): PitcherSplit | undefined {
  if (!line) return undefined
  return hand === 'L' ? line.vsL : hand === 'R' ? line.vsR : line
}

/** Replace the shown numbers with ours. ERA can't be split by batter hand → empty. */
function withOurNumbers(
  mlb: BullpenStats,
  allDcIds: number[],
  ours: Map<number, PitcherLine>,
  period: StatPeriod,
  hand: BullpenHand,
): BullpenStats {
  const eraFor = (p: BullpenPitcher, line: PitcherLine | undefined) =>
    hand !== 'all' ? null : period === 'season' ? p.era : (line?.record?.era ?? null)

  const pitchers = mlb.pitchers.map(p => {
    const line = ours.get(p.id)
    const s = pickSplit(line, hand)
    return {
      ...p,
      fip:      s?.fip ?? null,
      xfip:     s?.xfip ?? null,
      fipMinus: s?.fipMinus ?? null,
      whip:     s?.whip != null ? s.whip.toFixed(2) : null,
      ip:       s ? formatIp(s.ip) : null,
      k9:       s && s.ip > 0 ? ((s.so / s.ip) * 9).toFixed(1) : null,
      era:      eraFor(p, line),
    }
  })

  // Team totals: IP-weighted over every active reliever on the depth chart.
  let ipSum = 0, fipSum = 0, whipSum = 0, eraSum = 0, eraIp = 0
  for (const id of allDcIds) {
    const line = ours.get(id)
    const s = pickSplit(line, hand)
    if (!s || s.ip <= 0) continue
    ipSum += s.ip
    if (s.fipMinus != null) fipSum += s.fipMinus * s.ip
    if (s.whip != null) whipSum += s.whip * s.ip
    const era = line?.record?.era != null ? parseFloat(line.record.era) : NaN
    if (Number.isFinite(era)) { eraSum += era * s.ip; eraIp += s.ip }
  }
  return {
    pitchers,
    teamFipMinus: ipSum > 0 ? Math.round(fipSum / ipSum) : null,
    teamWhip:     ipSum > 0 ? (whipSum / ipSum).toFixed(2) : null,
    teamEra:      hand !== 'all' ? null : period === 'season' ? mlb.teamEra : eraIp > 0 ? (eraSum / eraIp).toFixed(2) : null,
  }
}

/** Backend down outside full season: show no numbers rather than mix periods. */
function withoutNumbers(mlb: BullpenStats): BullpenStats {
  return {
    pitchers: mlb.pitchers.map(p => ({ ...p, fip: null, xfip: null, fipMinus: null, whip: null, ip: null, k9: null, era: null })),
    teamFipMinus: null, teamEra: null, teamWhip: null,
  }
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

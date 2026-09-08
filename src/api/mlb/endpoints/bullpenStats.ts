import { mlbApi } from '../client'
import { loadLiveConstants, computeFip, computeFipMinus, type RawPitchingStat } from '../wrcConstants'
import { getFipParkFactor } from './parkFactors'
import { todayStr, type StatPeriod } from '@/utils/period'
import { loadPitcherHandSplits, getEffectivePitcherHandSplitStats } from './pitcherHandSplitsCache'
import { loadHandSplitsRollup } from './handSplitsRollup'

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

/** Inverse of ipToDecimal — decimal innings back to MLB's thirds-notation string ("5.1" = 5⅓). */
function decimalToIpString(ip: number): string {
  let whole = Math.floor(ip)
  let thirds = Math.round((ip - whole) * 3)
  if (thirds >= 3) { whole += 1; thirds = 0 }
  return `${whole}.${thirds}`
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
  startDate?: string,
  statSeason: number = new Date().getFullYear(),
  pitcherHand?: 'L' | 'R',
  period: StatPeriod = 'season',
): Promise<BullpenStats> {
  // Who's likely to pitch today is always based on the CURRENT roster/depth chart —
  // that prediction doesn't apply to a past season. Only the stat VALUES shown for
  // those candidates (FIP/ERA/WHIP/etc.) follow the selected period, via statSeason.
  const rosterSeason = new Date().getFullYear()
  const season     = statSeason
  const endDate    = todayStr()
  await loadLiveConstants(statSeason)

  // Hand-filtered stats: season path from the FanGraphs cron cache, rolling-window
  // path from the PBP rollup — same source-selecting logic already used for starters
  // (LiveGamePage.tsx). Roster/candidate selection above and below is untouched by this.
  const [handSeasonCache, handRollupCache] = pitcherHand
    ? await Promise.all([loadPitcherHandSplits(statSeason), loadHandSplitsRollup(statSeason)])
    : [null, null]
  const resolveHand = (pid: number) =>
    pitcherHand
      ? getEffectivePitcherHandSplitStats(period, handSeasonCache, handRollupCache, pid, pitcherHand, statSeason, teamId)
      : undefined  // undefined = hand filter not active at all; null = active but no data for this pitcher

  const today      = new Date().toISOString().split('T')[0]
  const yesterday  = new Date(Date.now() -     86400000).toISOString().split('T')[0]
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().split('T')[0]
  const base = { group: 'pitching', season: rosterSeason, sportIds: 1, gameType: 'R', sitCodes: 'rp' }

  // ── Step 1: parallel fetches ───────────────────────────────────
  const [dcRes, frRes, saberRes, schedRes] = await Promise.all([
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'depthChart', season: rosterSeason,
      fields: 'roster,person,id,position,type,abbreviation,status,code',
    }),
    mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
      rosterType: 'fullRoster', season: rosterSeason,
      fields: 'roster,person,id,status,description',
    }),
    mlbApi.get<TeamStatResponse>(`/teams/${teamId}/stats`, { ...base, stats: 'sabermetrics' }),
    mlbApi.get<{ dates: Array<{ games: Array<{ gamePk: number; gameDate: string; status: { abstractGameState: string } }> }> }>(
      '/schedule', {
        sportId: 1, teamId, gameType: 'R',
        startDate: sevenDaysAgo, endDate: today,
        fields: 'dates,games,gamePk,gameDate,status,abstractGameState',
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
    .filter(g => g.status.abstractGameState === 'Final' && g.gameDate.split('T')[0] < today)
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
      const gameDate = completed[i].gameDate.split('T')[0]
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
  const peopleHydrate = startDate
    ? `stats(group=[pitching],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
    : `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`
  const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
    personIds: top8.join(','),
    season,
    hydrate: peopleHydrate,
    fields: [
      'people', 'id', 'fullName', 'pitchHand', 'code',
      'stats', 'type', 'displayName', 'splits', 'stat',
      'era', 'whip', 'inningsPitched', 'strikeoutsPer9Inn',
      'saves', 'holds', 'blownSaves',
      'inheritedRunners', 'inheritedRunnersScored',
      'homeRuns', 'strikeOuts', 'baseOnBalls', 'hitByPitch',
    ].join(','),
  })

  type RpStat = {
    era?: string; whip?: string; inningsPitched?: string; strikeoutsPer9Inn?: string
    saves?: number; holds?: number; blownSaves?: number
    inheritedRunners?: number; inheritedRunnersScored?: number
    homeRuns?: number; strikeOuts?: number; baseOnBalls?: number; hitByPitch?: number
  }
  const personMap = new Map<number, { fullName: string; hand: string; rp: RpStat }>()
  for (const p of peopleData.people ?? []) {
    const byType = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
    personMap.set(p.id, {
      fullName: p.fullName,
      hand:     p.pitchHand?.code ?? '?',
      rp:       (byType.get(startDate ? 'byDateRange' : 'statSplits') ?? {}) as RpStat,
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

    let fipMinusVal: number | null = null
    if (startDate) {
      const rawIp = ipToDecimal((ss as RpStat).inningsPitched)
      const rawFip = computeFip({
        inningsPitched: rawIp,
        homeRuns:    (ss as RpStat).homeRuns    ?? 0,
        baseOnBalls: (ss as RpStat).baseOnBalls ?? 0,
        hitByPitch:  (ss as RpStat).hitByPitch  ?? 0,
        strikeOuts:  (ss as RpStat).strikeOuts  ?? 0,
      }, season, 1)
      if (rawFip != null) fipMinusVal = computeFipMinus(rawFip, season, getFipParkFactor(teamId))
    } else {
      fipMinusVal = s?.fipMinus ?? null
    }

    // Hand filter active → replace entirely with hand-split values (or null if this
    // pitcher has no data for that hand/window) — never fall back to the unfiltered
    // period value, which would be a different, mislabeled number.
    const handOverride = resolveHand(pid)
    const useHand = handOverride !== undefined

    pitchers.push({
      id:         pid,
      name:       person?.fullName ?? `ID${pid}`,
      hand:       person?.hand     ?? '?',
      fip:        useHand ? (handOverride?.fip ?? null)      : (s?.fip  ?? null),
      xfip:       useHand ? (handOverride?.xfip ?? null)     : (s?.xfip ?? null),
      fipMinus:   useHand ? (handOverride?.fipMinus ?? null) : fipMinusVal,
      eraMinus:   s?.eraMinus   ?? null,
      war:        s?.war        ?? null,
      pli:        s?.pli        ?? null,
      gmli:       s?.gmli       ?? null,
      era:        useHand ? (handOverride?.era  != null ? handOverride.era.toFixed(2)  : null) : ((ss as RpStat).era                ?? null),
      whip:       useHand ? (handOverride?.whip != null ? handOverride.whip.toFixed(2) : null) : ((ss as RpStat).whip               ?? null),
      ip:         useHand ? (handOverride?.ip   != null ? decimalToIpString(handOverride.ip)  : null) : ((ss as RpStat).inningsPitched    ?? null),
      k9:         useHand ? (handOverride?.k9   != null ? handOverride.k9.toFixed(2)   : null) : ((ss as RpStat).strikeoutsPer9Inn ?? null),
      saves:      (ss as RpStat).saves      ?? 0,
      holds:      (ss as RpStat).holds      ?? 0,
      blownSaves: (ss as RpStat).blownSaves ?? 0,
      strandRate: ir > 0 ? Math.round((1 - irs / ir) * 100) : null,
    })
  }

  // ── Step 9: team aggregates from all active DC arms ────────────
  // Use full sabermetrics set (not just top-8) for accurate team FIP-
  const allDcIds = [...isRP].filter(id => !ilSet.has(id))

  type AggEntry = { fipMinus: number | null; ip: number; era: number; whip: number }
  const aggEntries: AggEntry[] = []

  if (pitcherHand) {
    // Hand filter active — build the aggregate straight from the same hand-split
    // source used for the top-8 list above, skipping the /people fetch entirely
    // (no unfiltered-period data needed at all in this branch).
    for (const pid of allDcIds) {
      const hs = resolveHand(pid)
      if (!hs || hs.ip == null || hs.ip <= 0) continue
      aggEntries.push({
        fipMinus: hs.fipMinus,
        ip: hs.ip,
        era: 0,   // ERA isn't derivable for the rolling-window hand-split path (see
                  // pitcherHandSplitsCache.ts) — team ERA is omitted below when hand-filtered.
        whip: hs.whip ?? 0,
      })
    }
  } else {
    const aggHydrate = startDate
      ? `stats(group=[pitching],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
      : `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`
    const allDcPeopleData = allDcIds.length
      ? await mlbApi.get<{ people: RawPerson[] }>('/people', {
          personIds: allDcIds.join(','),
          season,
          hydrate: aggHydrate,
          fields: 'people,id,stats,type,displayName,splits,stat,era,whip,inningsPitched,homeRuns,strikeOuts,baseOnBalls,hitByPitch',
        })
      : { people: [] }

    for (const p of allDcPeopleData.people ?? []) {
      const byType = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
      const rpStat = (byType.get(startDate ? 'byDateRange' : 'statSplits') ?? {}) as {
        inningsPitched?: string; era?: string; whip?: string
        homeRuns?: number; strikeOuts?: number; baseOnBalls?: number; hitByPitch?: number
      }
      const ip = ipToDecimal(rpStat.inningsPitched)
      if (ip === 0) continue

      let aggFipMinus: number | null = null
      if (startDate) {
        const rawFip = computeFip({
          inningsPitched: ip,
          homeRuns:    rpStat.homeRuns    ?? 0,
          baseOnBalls: rpStat.baseOnBalls ?? 0,
          hitByPitch:  rpStat.hitByPitch  ?? 0,
          strikeOuts:  rpStat.strikeOuts  ?? 0,
        }, season, 1)
        if (rawFip != null) aggFipMinus = computeFipMinus(rawFip, season, getFipParkFactor(teamId))
      } else {
        aggFipMinus = (saberByPid.get(p.id) as { fipMinus?: number } | undefined)?.fipMinus ?? null
      }

      aggEntries.push({
        fipMinus: aggFipMinus,
        ip,
        era:  parseFloat(rpStat.era  ?? '0'),
        whip: parseFloat(rpStat.whip ?? '0'),
      })
    }
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
    // Team ERA isn't derivable on the hand-filtered rolling-window path — left null
    // rather than showing a bogus "0.00" average of the era:0 placeholder above.
    teamEra  = pitcherHand ? null : (aggEntries.reduce((s, e) => s + e.era  * e.ip, 0) / totalIP).toFixed(2)
    teamWhip = (aggEntries.reduce((s, e) => s + e.whip * e.ip, 0) / totalIP).toFixed(2)
  }

  return { pitchers, teamFipMinus, teamEra, teamWhip }
}

/**
 * Lightweight batch fetch for the schedule-page bullpen bar.
 * Computes FIP from raw counting stats (HR/BB/HBP/K/IP) so date-range filtering
 * works the same as full-season mode. Returns Map<teamId, fipPlus>.
 */
export async function fetchBullpenFipPlusMap(
  teamIds: number[],
  startDate?: string,
  statSeason: number = new Date().getFullYear(),
  pitcherHand?: 'L' | 'R',
  period: StatPeriod = 'season',
): Promise<Map<number, number>> {
  if (!teamIds.length) return new Map()

  // Depth chart (who's a reliever) is always current; only the stats shown follow statSeason.
  const rosterSeason = new Date().getFullYear()
  const season  = statSeason
  const endDate = todayStr()
  await loadLiveConstants(statSeason)

  const [handSeasonCache, handRollupCache] = pitcherHand
    ? await Promise.all([loadPitcherHandSplits(statSeason), loadHandSplitsRollup(statSeason)])
    : [null, null]

  // Step 1: DC rosters for all teams in parallel
  const rosterResults = await Promise.all(
    teamIds.map(teamId =>
      mlbApi.get<{ roster: RosterEntry[] }>(`/teams/${teamId}/roster`, {
        rosterType: 'depthChart',
        season: rosterSeason,
        fields: 'roster,person,id,position,abbreviation,status,code',
      }).then(res => {
        const ids = (res.roster ?? [])
          .filter(e =>
            e.status.code === 'A' &&
            (e.position.abbreviation === 'P' || e.position.abbreviation === 'CP'),
          )
          .map(e => e.person.id)
        return { teamId, ids }
      }),
    ),
  )

  const teamPitchers = new Map<number, number[]>()
  const allPitcherIds = new Set<number>()
  for (const { teamId, ids } of rosterResults) {
    teamPitchers.set(teamId, ids)
    for (const id of ids) allPitcherIds.add(id)
  }
  if (!allPitcherIds.size) return new Map()

  // Step 2/3: FIP per pitcher, either from raw MLB counting stats (unfiltered) or
  // from the hand-split source (same as fetchBullpenStats' resolveHand pattern).
  type PitcherEntry = { rawFip: number; ip: number }
  const pitcherMap = new Map<number, PitcherEntry>()

  if (pitcherHand) {
    const pitcherTeamMap = new Map<number, number>()
    for (const [teamId, pitcherIds] of teamPitchers) for (const id of pitcherIds) pitcherTeamMap.set(id, teamId)

    for (const pid of allPitcherIds) {
      const hs = getEffectivePitcherHandSplitStats(
        period, handSeasonCache, handRollupCache, pid, pitcherHand, statSeason, pitcherTeamMap.get(pid),
      )
      if (!hs || hs.fip == null || hs.ip == null || hs.ip <= 0) continue
      pitcherMap.set(pid, { rawFip: hs.fip, ip: hs.ip })
    }
  } else {
    // sitCodes=[rp] only works with statSplits, not byDateRange. For date ranges,
    // fetch all pitching for DC relievers — their innings are overwhelmingly in relief.
    const hydrate = startDate
      ? `stats(group=[pitching],type=[byDateRange],season=${season},startDate=${startDate},endDate=${endDate})`
      : `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})`
    const peopleData = await mlbApi.get<{ people: RawPerson[] }>('/people', {
      personIds: [...allPitcherIds].join(','),
      season,
      hydrate,
      fields: 'people,id,stats,type,displayName,splits,stat,inningsPitched,homeRuns,baseOnBalls,hitByPitch,strikeOuts',
    })

    for (const p of peopleData.people ?? []) {
      const stat = (p.stats ?? [])
        .find(s => ['statSplits', 'byDateRange', 'season'].includes(s.type.displayName))
        ?.splits?.[0]?.stat as Record<string, unknown> | undefined
      if (!stat) continue

      const ip = ipToDecimal(stat.inningsPitched as string | undefined)
      const raw: RawPitchingStat = {
        inningsPitched: ip,
        homeRuns:    typeof stat.homeRuns    === 'number' ? stat.homeRuns    : 0,
        baseOnBalls: typeof stat.baseOnBalls === 'number' ? stat.baseOnBalls : 0,
        hitByPitch:  typeof stat.hitByPitch  === 'number' ? stat.hitByPitch  : 0,
        strikeOuts:  typeof stat.strikeOuts  === 'number' ? stat.strikeOuts  : 0,
      }
      // Lower IP floor for date ranges so active relievers (1+ IP) are included
      const fip = computeFip(raw, season, startDate ? 1 : undefined)
      if (fip == null) continue
      pitcherMap.set(p.id, { rawFip: fip, ip })
    }
  }

  // Step 4: IP-weighted FIP- per team → FIP+
  const map = new Map<number, number>()
  for (const [teamId, pitcherIds] of teamPitchers) {
    const pf = getFipParkFactor(teamId)
    const entries = pitcherIds
      .map(id => pitcherMap.get(id))
      .filter((e): e is PitcherEntry => e != null)

    const totalIP = entries.reduce((s, e) => s + e.ip, 0)
    if (totalIP === 0) continue

    const teamFipMinus = entries.reduce((s, e) => s + computeFipMinus(e.rawFip, season, pf) * e.ip, 0) / totalIP
    map.set(teamId, Math.round(200 - teamFipMinus))
  }

  return map
}

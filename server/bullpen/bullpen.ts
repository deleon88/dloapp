// Bullpen of a team for the game page: the arms most likely to pitch today
// (selectBullpen) with their numbers for the chosen period / batter hand, the
// team's relief totals and the recent pitch-count strip — in one response.
//
// Recent usage comes from pitcher_appearances (filled by the ingest). Games
// that finished after the last ingest (e.g. earlier today) are read from MLB's
// boxscore on the fly, so availability is never behind.
import { sql } from '../db.js'
import { getJson } from '../mlb/pbp.js'
import { fetchAppearances, type AppearanceRow } from '../mlb/appearances.js'
import { etDate } from '../ingest.js'
import { resolvePeriod, type Period } from '../stats/batting.js'
import { getPitcherLines, type PitcherLine, type PitcherSplit } from '../stats/pitching.js'
import { getPitcherRecords, type PitcherRecord } from '../mlb/pitcherRecord.js'
import { selectBullpen, type Appearance } from './select.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const AVAILABILITY_GAMES = 7   // games looked at for rest / frequency
const STRIP_GAMES = 5          // games shown in the usage strip

export type BullpenHand = 'all' | 'L' | 'R'

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
  /** wOBA allowed and batters faced, for the period / batter hand (shown instead of ERA with a hand filter). */
  wobaAgainst: number | null
  bf: number | null
}

export interface BullpenUsage {
  days: Array<{ gamePk: number; date: string; label: string }>
  /** Pitches per game for each listed pitcher, same order as `days`. */
  pitches: Record<string, number[]>
}

export interface Bullpen {
  pitchers: BullpenPitcher[]
  teamFipMinus: number | null
  teamEra: string | null
  teamWhip: string | null
  usage: BullpenUsage
  /** Batter-hand filter these numbers are for. */
  hand: BullpenHand
}

interface RosterEntry {
  person: { id: number }
  position?: { type?: string; abbreviation?: string }
  status?: { code?: string; description?: string }
}

type Stat = Record<string, unknown>

const ipToDecimal = (ip: unknown) => {
  if (typeof ip !== 'string' || !ip) return 0
  const [whole, thirds] = ip.split('.').map(Number)
  return (whole || 0) + (thirds || 0) / 3
}
const formatIp = (ip: number) => { const outs = Math.round(ip * 3); return `${Math.floor(outs / 3)}.${outs % 3}` }
const dateLabel = (d: string) => { const [, m, day] = d.split('-'); return `${Number(m)}/${Number(day)}` }

/** Team's completed games from `from` to `to` (ET), oldest first, one entry per game. */
async function completedGames(teamId: number, from: string, to: string) {
  const data = await getJson<{ dates?: Array<{ games?: Array<{ gamePk: number; officialDate: string; status?: { abstractGameState?: string } }> }> }>(
    `${MLB_API}/schedule?sportId=1&teamId=${teamId}&startDate=${from}&endDate=${to}&fields=dates,games,gamePk,officialDate,status,abstractGameState`,
  )
  const seen = new Set<number>()
  return (data.dates ?? []).flatMap(d => d.games ?? [])
    .filter(g => g.status?.abstractGameState === 'Final' && !seen.has(g.gamePk) && seen.add(g.gamePk))
    .map(g => ({ gamePk: g.gamePk, date: g.officialDate }))
}

/** This team's pitcher appearances in those games: from the database, or the boxscore if not ingested yet. */
async function appearancesFor(teamId: number, gamePks: number[]): Promise<Map<number, AppearanceRow[]>> {
  const out = new Map<number, AppearanceRow[]>()
  if (!gamePks.length) return out
  const rows = await sql<AppearanceRow[]>`
    SELECT game_pk, pitcher_id, team_id, seq, pitches, batters_faced, outs
    FROM pitcher_appearances WHERE game_pk = ANY(${gamePks}) AND team_id = ${teamId}`
  for (const r of rows) out.set(r.game_pk, [...(out.get(r.game_pk) ?? []), r])
  const missing = gamePks.filter(pk => !out.has(pk))
  const fetched = await Promise.all(missing.map(pk => fetchAppearances(pk).catch(() => [])))
  missing.forEach((pk, i) => out.set(pk, fetched[i].filter(r => r.team_id === teamId)))
  return out
}

function pickSplit(line: PitcherLine | undefined, hand: BullpenHand): PitcherSplit | undefined {
  if (!line) return undefined
  return hand === 'L' ? line.vsL : hand === 'R' ? line.vsR : line
}

export async function getBullpen(teamId: number, opts: { season: number; period: Period; hand: BullpenHand }): Promise<Bullpen> {
  const { season, period, hand } = opts
  const today = etDate()
  const daysAgo = (n: number) => etDate(new Date(Date.now() - n * 86_400_000))
  const rp = `group=pitching&season=${season}&sportIds=1&gameType=R&sitCodes=rp`

  // ── MLB: depth chart, injured list, relief sabermetrics, recent games ──
  const [dc, full, saber, games] = await Promise.all([
    getJson<{ roster?: RosterEntry[] }>(`${MLB_API}/teams/${teamId}/roster?rosterType=depthChart&season=${season}&fields=roster,person,id,position,type,abbreviation,status,code`),
    getJson<{ roster?: RosterEntry[] }>(`${MLB_API}/teams/${teamId}/roster?rosterType=fullRoster&season=${season}&fields=roster,person,id,status,description`),
    getJson<{ stats?: Array<{ splits?: Array<{ player: { id: number }; stat: Stat }> }> }>(`${MLB_API}/teams/${teamId}/stats?${rp}&stats=sabermetrics`),
    completedGames(teamId, daysAgo(14), today),
  ])

  const injured = new Set((full.roster ?? [])
    .filter(r => (r.status?.description ?? '').startsWith('Injured')).map(r => r.person.id))
  const depthChart: Array<{ id: number; isCloser: boolean; order: number }> = []
  for (const r of dc.roster ?? []) {
    if (r.status?.code !== 'A') continue
    const abbr = r.position?.abbreviation
    if (abbr === 'CP' || (r.position?.type === 'Pitcher' && abbr !== 'SP')) {
      depthChart.push({ id: r.person.id, isCloser: abbr === 'CP', order: depthChart.length })
    }
  }
  const saberById = new Map((saber.stats?.[0]?.splits ?? []).map(s => [s.player.id, s.stat]))

  // ── Recent usage (database first) ──
  const windowStart = daysAgo(8)
  const beforeToday = games.filter(g => g.date >= windowStart && g.date < today).slice(-AVAILABILITY_GAMES)
  const strip = games.slice(-STRIP_GAMES)
  const apps = await appearancesFor(teamId, [...new Set([...beforeToday, ...strip].map(g => g.gamePk))])

  const usage = new Map<number, Appearance[]>()
  for (const g of beforeToday) {
    for (const a of apps.get(g.gamePk) ?? []) {
      usage.set(a.pitcher_id, [...(usage.get(a.pitcher_id) ?? []), { date: g.date, pitches: a.pitches, isStarter: a.seq === 0 }])
    }
  }

  const top = selectBullpen({
    depthChart, injured,
    pli: new Map([...saberById].map(([id, s]) => [id, Number(s.pli ?? 0)])),
    usage, gamesPlayed: beforeToday.length,
    today, yesterday: daysAgo(1), twoDaysAgo: daysAgo(2),
  }).map(x => x.id)

  const usageOut: BullpenUsage = {
    days: strip.map(g => ({ gamePk: g.gamePk, date: g.date, label: dateLabel(g.date) })),
    pitches: Object.fromEntries(top.map(id => [id, strip.map(g =>
      apps.get(g.gamePk)?.find(a => a.pitcher_id === id)?.pitches ?? 0)])),
  }
  if (!top.length) return { pitchers: [], teamFipMinus: null, teamEra: null, teamWhip: null, usage: usageOut, hand }

  // ── Relief stats from MLB (names, hands, ERA, saves…) for the shown arms and the whole pen ──
  const allDc = depthChart.map(a => a.id).filter(id => !injured.has(id))
  const ids = [...new Set([...top, ...allDc])]
  const people = await getJson<{ people?: Array<{ id: number; fullName: string; pitchHand?: { code?: string }; stats?: Array<{ splits?: Array<{ stat: Stat }> }> }> }>(
    `${MLB_API}/people?personIds=${ids.join(',')}&hydrate=stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season})` +
    '&fields=people,id,fullName,pitchHand,code,stats,splits,stat,era,whip,inningsPitched,strikeoutsPer9Inn,saves,holds,blownSaves,inheritedRunners,inheritedRunnersScored',
  )
  const person = new Map((people.people ?? []).map(p => [p.id, p]))
  const reliefStat = (id: number): Stat => person.get(id)?.stats?.[0]?.splits?.[0]?.stat ?? {}

  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const mlbPitchers: BullpenPitcher[] = top.map(id => {
    const s = saberById.get(id) ?? {}
    const r = reliefStat(id)
    const ir = Number(r.inheritedRunners ?? 0), irs = Number(r.inheritedRunnersScored ?? 0)
    return {
      id,
      name: person.get(id)?.fullName ?? `ID${id}`,
      hand: person.get(id)?.pitchHand?.code ?? '?',
      fip: num(s.fip), xfip: num(s.xfip), fipMinus: num(s.fipMinus), eraMinus: num(s.eraMinus),
      war: num(s.war), pli: num(s.pli), gmli: num(s.gmli),
      era: str(r.era), whip: str(r.whip), ip: str(r.inningsPitched), k9: str(r.strikeoutsPer9Inn),
      saves: Number(r.saves ?? 0), holds: Number(r.holds ?? 0), blownSaves: Number(r.blownSaves ?? 0),
      strandRate: ir > 0 ? Math.round((1 - irs / ir) * 100) : null,
      wobaAgainst: null,   // filled below with our lines
      bf: null,
    }
  })

  // MLB's season relief ERA for the team row (IP-weighted over the healthy pen).
  let mlbIp = 0, mlbEra = 0
  for (const id of allDc) {
    const r = reliefStat(id), ip = ipToDecimal(r.inningsPitched)
    if (ip > 0 && typeof r.era === 'string') { mlbIp += ip; mlbEra += parseFloat(r.era) * ip }
  }
  const mlbTeamEra = mlbIp > 0 ? (mlbEra / mlbIp).toFixed(2) : null

  // ── Our numbers for the period / hand ──
  const range = await resolvePeriod(season, period)
  const [lines, records] = await Promise.all([
    getPitcherLines({ season, pitcherIds: ids, role: 'rp', ...range }),
    getPitcherRecords({ season, pitcherIds: ids, ...range, reliefOnly: true }).catch(() => new Map<number, PitcherRecord>()),
  ])
  const eraFor = (mlbEra: string | null, id: number) =>
    hand !== 'all' ? null : period === 'season' ? mlbEra : (records.get(id)?.era ?? null)

  const pitchers = mlbPitchers.map(p => {
    const s = pickSplit(lines.get(p.id), hand)
    return {
      ...p,
      fip: s?.fip ?? null,
      xfip: s?.xfip ?? null,
      fipMinus: s?.fipMinus ?? null,
      whip: s?.whip != null ? s.whip.toFixed(2) : null,
      ip: s ? formatIp(s.ip) : null,
      k9: s && s.ip > 0 ? ((s.so / s.ip) * 9).toFixed(1) : null,
      era: eraFor(p.era, p.id),
      wobaAgainst: s?.wobaAgainst ?? null,
      bf: s?.bf ?? null,
    }
  })

  // Team totals: IP-weighted over every healthy reliever on the depth chart.
  let ipSum = 0, fipSum = 0, whipSum = 0, eraSum = 0, eraIp = 0
  for (const id of allDc) {
    const s = pickSplit(lines.get(id), hand)
    if (!s || s.ip <= 0) continue
    ipSum += s.ip
    if (s.fipMinus != null) fipSum += s.fipMinus * s.ip
    if (s.whip != null) whipSum += s.whip * s.ip
    const era = parseFloat(records.get(id)?.era ?? '')
    if (Number.isFinite(era)) { eraSum += era * s.ip; eraIp += s.ip }
  }
  return {
    pitchers,
    teamFipMinus: ipSum > 0 ? Math.round(fipSum / ipSum) : null,
    teamWhip: ipSum > 0 ? (whipSum / ipSum).toFixed(2) : null,
    teamEra: hand !== 'all' ? null : period === 'season' ? mlbTeamEra : eraIp > 0 ? (eraSum / eraIp).toFixed(2) : null,
    usage: usageOut,
    hand,
  }
}

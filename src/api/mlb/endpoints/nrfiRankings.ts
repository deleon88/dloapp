import { mlbApi } from '../client'
import { fetchNrfiMatchup } from './nrfi'
import { fetchPitcherStats } from './pitcherStats'
import { getPitchHands } from './people'
import { getParkInfo } from './parkFactors'
import type { NrfiMatchupData, StarterFirstInningStats } from './nrfi'
import type { LineupSlot } from './boxscore'
import type { PitcherSeasonStats } from './pitcherStats'

function toLineupSlots(players: Array<{ id: number; fullName: string }>): LineupSlot[] {
  return players.map(p => ({
    id:           p.id,
    fullName:     p.fullName,
    pos:          '',
    avg:          '',
    obp:          '',
    pa:           null,
    jerseyNumber: '',
  }))
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface NrfiSignal {
  type: 'positive' | 'negative' | 'neutral'
  label: string
  value: string
}

export type NrfiConfidence = 'high' | 'medium' | 'low'

export interface NrfiStarterSummary {
  id: number
  name: string
  hand: string
  era: string       // i01 ERA
  whip: string      // i01 WHIP
  kRate: number | null  // SP season K% (per BF)
  bbRate: number | null // SP season BB%
  xfip: number | null
  i01Games: number
}

export interface NrfiGameRanking {
  gamePk: number
  gameDate: string
  awayTeamId: number
  homeTeamId: number
  awayTeamName: string
  homeTeamName: string
  awayStarter: NrfiStarterSummary | null
  homeStarter: NrfiStarterSummary | null
  // Block scores 0-100
  pitcherScore: number
  lineupScore: number
  trendScore: number
  contextScore: number
  // Final
  nrfiScore: number
  yrfiScore: number
  confidence: NrfiConfidence
  topSignals: NrfiSignal[]
  weather: { condition: string; temp: string; wind: string } | null
  parkName: string
  parkFactor: number
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** Lower raw value → higher score (e.g. ERA: lower is better). */
function invertLinear(raw: number, worst: number, best: number): number {
  if (worst === best) return 50
  return clamp(((worst - raw) / (worst - best)) * 100)
}

/** Higher raw value → higher score (e.g. K%: higher is better for NRFI). */
function linear(raw: number, worst: number, best: number): number {
  if (worst === best) return 50
  return clamp(((raw - worst) / (best - worst)) * 100)
}

function parseOps(ops: string | undefined): number {
  const v = parseFloat(ops ?? '')
  return isNaN(v) ? 0.750 : v
}

function parseEra(era: string | undefined): number {
  if (!era || era === '-.--') return 4.50
  const v = parseFloat(era)
  return isNaN(v) ? 4.50 : v
}

// ── Block scoring functions ───────────────────────────────────────────────────

function scorePitcher(
  starter: StarterFirstInningStats | null,
  pitcherStats: PitcherSeasonStats | undefined,
): { score: number; confidence: number } {
  if (!starter && !pitcherStats) return { score: 50, confidence: 0 }

  let weightedSum = 0
  let totalWeight = 0

  // i01 ERA — most direct signal (weight 30)
  if (starter && starter.gamesPlayed >= 2) {
    const era = parseEra(starter.era)
    weightedSum += invertLinear(era, 9.0, 0.0) * 30
    totalWeight += 30
  }

  // i01 K% (weight 20)
  if (starter && starter.battersFaced > 0) {
    const kRate = starter.strikeOuts / starter.battersFaced
    weightedSum += linear(kRate, 0, 0.35) * 20
    totalWeight += 20
  } else if (starter?.spKRate != null) {
    // Fall back to SP season K%
    weightedSum += linear(starter.spKRate, 0, 0.30) * 15
    totalWeight += 15
  }

  // i01 BB% inverted (weight 15)
  if (starter && starter.battersFaced > 0) {
    const bbRate = starter.baseOnBalls / starter.battersFaced
    weightedSum += invertLinear(bbRate, 0.15, 0) * 15
    totalWeight += 15
  } else if (starter?.spBBRate != null) {
    weightedSum += invertLinear(starter.spBBRate, 0.15, 0) * 10
    totalWeight += 10
  }

  // SP season K% as supplemental signal (weight 15) — only when i01 data is thin
  if (starter?.spKRate != null && (starter.battersFaced === 0 || starter.gamesPlayed < 3)) {
    weightedSum += linear(starter.spKRate, 0, 0.30) * 15
    totalWeight += 15
  }

  // xFIP season (weight 20)
  if (pitcherStats?.xfip && pitcherStats.xfip > 0) {
    weightedSum += invertLinear(pitcherStats.xfip, 6.5, 2.5) * 20
    totalWeight += 20
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 50
  const confidence = Math.min(100, totalWeight)
  return { score, confidence }
}

function scoreLineup(
  matchup: NrfiMatchupData,
  side: 'away' | 'home',   // the batting team
): number {
  const snap = matchup[side]

  let weightedSum = 0
  let totalWeight = 0

  // OPS vs pitcher hand for top 4 batters (weight 35)
  const top4 = snap.lineup.slice(0, 4)
  const vsHandOps = top4.map(p => parseOps(p.vsHand?.ops ?? p.firstInning?.ops)).filter(v => v > 0)
  if (vsHandOps.length > 0) {
    const avgOps = vsHandOps.reduce((s, v) => s + v, 0) / vsHandOps.length
    weightedSum += invertLinear(avgOps, 1.050, 0.550) * 35
    totalWeight += 35
  }

  // K% vs hand for top 4 batters (higher K% = good for NRFI) (weight 25)
  const vsHandKRates = top4
    .map(p => {
      const pa = p.vsHand?.plateAppearances ?? p.firstInning?.plateAppearances ?? 0
      const k  = p.vsHand?.strikeOuts       ?? p.firstInning?.strikeOuts       ?? 0
      return pa > 0 ? k / pa : null
    })
    .filter((v): v is number => v != null)
  if (vsHandKRates.length > 0) {
    const avgK = vsHandKRates.reduce((s, v) => s + v, 0) / vsHandKRates.length
    weightedSum += linear(avgK, 0.10, 0.38) * 25
    totalWeight += 25
  }

  // Team i01 OPS (weight 25)
  if (snap.offense) {
    const teamOps = parseOps(snap.offense.ops)
    weightedSum += invertLinear(teamOps, 1.000, 0.500) * 25
    totalWeight += 25
  }

  // Team i01 K rate (weight 15)
  if (snap.offense && snap.offense.atBats > 0) {
    const kRate = snap.offense.strikeOuts / (snap.offense.atBats + snap.offense.baseOnBalls)
    weightedSum += linear(kRate, 0.10, 0.35) * 15
    totalWeight += 15
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 50
}

function scoreTrends(matchup: NrfiMatchupData): number {
  const { away, home } = matchup

  let weightedSum = 0
  let totalWeight = 0

  // Away team 1st inning score rate (low = good for NRFI) (weight 30)
  if (away.trend.seasonGames >= 5) {
    weightedSum += invertLinear(away.trend.scoredRate, 1.0, 0.0) * 30
    totalWeight += 30
  }

  // Home team 1st inning allowed rate (low = good for NRFI) (weight 30)
  if (home.trend.seasonGames >= 5) {
    weightedSum += invertLinear(home.trend.allowedRate, 1.0, 0.0) * 30
    totalWeight += 30
  }

  // Combined NRFI rate for both teams (weight 20 + 20)
  if (away.trend.seasonGames >= 5) {
    weightedSum += linear(away.trend.nrfiRate, 0, 1) * 20
    totalWeight += 20
  }
  if (home.trend.seasonGames >= 5) {
    weightedSum += linear(home.trend.nrfiRate, 0, 1) * 20
    totalWeight += 20
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 50
}

function scoreContext(
  homeTeamId: number,
  weather: { condition?: string; temp?: string; wind?: string } | null,
): number {
  const park = getParkInfo(homeTeamId)
  let score = 50

  // Park factor (weight 50): lower factor = better for NRFI
  const parkScore = invertLinear(park.factor, 1.45, 0.80)
  score = 50 + (parkScore - 50) * 0.50

  if (park.isDome) {
    score += 5  // controlled environment slightly favors NRFI
  }

  if (!weather) return clamp(score)

  // Temperature (weight 25): cold → harder to hit
  const temp = parseInt(weather.temp ?? '70')
  if (!isNaN(temp)) {
    if (temp < 45)      score += 10
    else if (temp < 55) score += 6
    else if (temp < 62) score += 3
    else if (temp > 88) score -= 4
  }

  // Wind (weight 25): blowing in = NRFI, blowing out = YRFI
  const wind = (weather.wind ?? '').toLowerCase()
  const speedMatch = wind.match(/(\d+)/)
  const windSpeed = speedMatch ? parseInt(speedMatch[1]) : 0
  if (wind.includes('in') || wind.includes('toward')) {
    score += Math.min(12, windSpeed * 0.8)
  } else if (wind.includes('out') || wind.includes('away')) {
    score -= Math.min(12, windSpeed * 0.8)
  } else if (windSpeed > 14) {
    score += 3  // strong crosswind slightly favors pitchers
  }

  return clamp(score)
}

// ── Signal extraction ─────────────────────────────────────────────────────────

function buildSignals(
  matchup: NrfiMatchupData,
  pitcherStats: Map<number, PitcherSeasonStats>,
  homeTeamId: number,
  weather: { condition: string; temp: string; wind: string } | null,
): NrfiSignal[] {
  const signals: Array<NrfiSignal & { weight: number }> = []
  const park = getParkInfo(homeTeamId)

  const addPos = (label: string, value: string, weight: number) =>
    signals.push({ type: 'positive', label, value, weight })
  const addNeg = (label: string, value: string, weight: number) =>
    signals.push({ type: 'negative', label, value, weight })

  // Starters
  for (const side of ['away', 'home'] as const) {
    const starter = matchup[side].starter
    if (!starter) continue
    const shortName = starter.fullName.split(' ').pop() ?? starter.fullName
    const label = `${shortName} 1st inn ERA`

    if (starter.gamesPlayed >= 3) {
      const era = parseEra(starter.era)
      if (era <= 1.50)       addPos(label, starter.era, 15)
      else if (era <= 2.50)  addPos(label, starter.era, 8)
      else if (era >= 5.50)  addNeg(label, starter.era, 12)
      else if (era >= 4.00)  addNeg(label, starter.era, 6)
    }

    const ps = starter.id ? pitcherStats.get(starter.id) : undefined
    if (ps?.xfip && ps.xfip > 0) {
      if (ps.xfip <= 3.20)      addPos(`${shortName} xFIP`, ps.xfip.toFixed(2), 10)
      else if (ps.xfip >= 5.00) addNeg(`${shortName} xFIP`, ps.xfip.toFixed(2), 8)
    }

    const kRate = starter.spKRate
    if (kRate != null) {
      const kPct = Math.round(kRate * 100)
      if (kRate >= 0.28)       addPos(`${shortName} K%`, `${kPct}%`, 8)
      else if (kRate <= 0.16)  addNeg(`${shortName} K%`, `${kPct}%`, 6)
    }
  }

  // Lineup
  for (const side of ['away', 'home'] as const) {
    const top4 = matchup[side].lineup.slice(0, 4)
    const teamName = side === 'away' ? 'Away' : 'Home'
    const vsOps = top4.map(p => parseOps(p.vsHand?.ops)).filter(v => v > 0.400)
    if (vsOps.length >= 2) {
      const avg = vsOps.reduce((s, v) => s + v, 0) / vsOps.length
      const str = avg.toFixed(3)
      if (avg <= 0.650)      addPos(`${teamName} lineup OPS vs SP`, str, 10)
      else if (avg >= 0.900) addNeg(`${teamName} lineup OPS vs SP`, str, 10)
    }
  }

  // Team i01 trends
  const { away, home } = matchup
  if (away.trend.seasonGames >= 8) {
    const sr = Math.round(away.trend.scoredRate * 100)
    if (away.trend.scoredRate <= 0.30) addPos('Away team scores 1st inn', `${sr}%`, 8)
    if (away.trend.scoredRate >= 0.55) addNeg('Away team scores 1st inn', `${sr}%`, 8)
  }
  if (home.trend.seasonGames >= 8) {
    const ar = Math.round(home.trend.allowedRate * 100)
    if (home.trend.allowedRate <= 0.30) addPos('Home allows 1st inn run', `${ar}%`, 8)
    if (home.trend.allowedRate >= 0.55) addNeg('Home allows 1st inn run', `${ar}%`, 8)
  }

  // Park
  if (park.factor >= 1.20) addNeg('Park factor', park.factor.toFixed(2), 12)
  if (park.factor <= 0.92) addPos('Park factor', park.factor.toFixed(2), 8)

  // Weather
  if (weather) {
    const wind = weather.wind.toLowerCase()
    const speedMatch = wind.match(/(\d+)/)
    const windSpeed = speedMatch ? parseInt(speedMatch[1]) : 0
    if (wind.includes('in') && windSpeed >= 8)
      addPos('Wind blowing in', weather.wind, 10)
    if (wind.includes('out') && windSpeed >= 8)
      addNeg('Wind blowing out', weather.wind, 10)
    const temp = parseInt(weather.temp ?? '')
    if (!isNaN(temp) && temp < 50)
      addPos('Cold temp', `${temp}°F`, 6)
  }

  return signals
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map(({ type, label, value }) => ({ type, label, value }))
}

// ── Confidence rating ─────────────────────────────────────────────────────────

function computeConfidence(
  matchup: NrfiMatchupData,
  awayConf: number,
  homeConf: number,
): NrfiConfidence {
  const pitcherDataAvg = (awayConf + homeConf) / 2
  const trendGames = Math.min(matchup.away.trend.seasonGames, matchup.home.trend.seasonGames)

  if (pitcherDataAvg >= 60 && trendGames >= 10) return 'high'
  if (pitcherDataAvg >= 30 || trendGames >= 6)  return 'medium'
  return 'low'
}

// ── Schedule fetch ────────────────────────────────────────────────────────────

interface RawNrfiGame {
  gamePk: number
  gameDate: string
  teams: {
    away: { team: { id: number; name: string }; probablePitcher?: { id: number; fullName: string } }
    home: { team: { id: number; name: string }; probablePitcher?: { id: number; fullName: string } }
  }
  weather?: { condition?: string; temp?: string; wind?: string }
}

async function fetchNrfiSchedule(date: string): Promise<RawNrfiGame[]> {
  const data = await mlbApi.get<{ dates?: Array<{ games?: RawNrfiGame[] }> }>('/schedule', {
    date,
    sportId: 1,
    gameType: 'R',
    hydrate: 'probablePitcher,weather',
    fields: [
      'dates', 'games', 'gamePk', 'gameDate',
      'teams', 'away', 'home', 'team', 'id', 'name',
      'probablePitcher', 'fullName', 'id',
      'weather', 'condition', 'temp', 'wind',
    ].join(','),
  })
  return data.dates?.[0]?.games ?? []
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function fetchNrfiRankings(
  date: string,
  lineupMap: Map<number, Array<{ id: number; fullName: string }>>,
): Promise<NrfiGameRanking[]> {
  const season = new Date().getFullYear()

  const games = await fetchNrfiSchedule(date)
  if (!games.length) return []

  // Collect all pitcher IDs
  const allPitcherIds = [
    ...new Set(games.flatMap(g => [
      g.teams.away.probablePitcher?.id,
      g.teams.home.probablePitcher?.id,
    ].filter((id): id is number => id != null)),
  )
  ]

  // Bulk-fetch pitcher hands + season stats in parallel
  const [pitchHandMap, pitcherStatsMap] = await Promise.all([
    getPitchHands(allPitcherIds),
    fetchPitcherStats(allPitcherIds),
  ])

  // Fetch matchup data for all games in parallel (3 at a time to stay under rate limits)
  const rankings: NrfiGameRanking[] = []

  for (let i = 0; i < games.length; i += 3) {
    const batch = games.slice(i, i + 3)

    const batchResults = await Promise.all(batch.map(async (g) => {
      const awayId  = g.teams.away.team.id
      const homeId  = g.teams.home.team.id
      const awaySP  = g.teams.away.probablePitcher
      const homeSP  = g.teams.home.probablePitcher
      const awayHand = awaySP ? (pitchHandMap.get(awaySP.id) as 'R' | 'L' | undefined) : undefined
      const homeHand = homeSP ? (pitchHandMap.get(homeSP.id) as 'R' | 'L' | undefined) : undefined
      const awayLineup = toLineupSlots(lineupMap.get(awayId) ?? [])
      const homeLineup = toLineupSlots(lineupMap.get(homeId) ?? [])

      const matchup = await fetchNrfiMatchup({
        awayTeamId:      awayId,
        homeTeamId:      homeId,
        awayStarterId:   awaySP?.id,
        homeStarterId:   homeSP?.id,
        awayStarterHand: awayHand,
        homeStarterHand: homeHand,
        awayLineup,
        homeLineup,
        season,
      }).catch(() => null)

      if (!matchup) return null

      const weather = g.weather?.condition
        ? { condition: g.weather.condition, temp: g.weather.temp ?? '', wind: g.weather.wind ?? '' }
        : null

      const park = getParkInfo(homeId)

      // Compute block scores
      const awaySPStats = awaySP ? pitcherStatsMap.get(awaySP.id)?.seasonStats : undefined
      const homeSPStats = homeSP ? pitcherStatsMap.get(homeSP.id)?.seasonStats : undefined

      const { score: awayPScore, confidence: awayConf } = scorePitcher(matchup.away.starter, awaySPStats)
      const { score: homePScore, confidence: homeConf } = scorePitcher(matchup.home.starter, homeSPStats)
      const pitcherScore = (awayPScore + homePScore) / 2

      const awayLineupScore = scoreLineup(matchup, 'away')
      const homeLineupScore = scoreLineup(matchup, 'home')
      const lineupScore = (awayLineupScore + homeLineupScore) / 2

      const trendScore   = scoreTrends(matchup)
      const contextScore = scoreContext(homeId, weather)

      const nrfiScore = Math.round(
        pitcherScore * 0.45 +
        lineupScore  * 0.30 +
        trendScore   * 0.15 +
        contextScore * 0.10,
      )

      const spStats = new Map<number, PitcherSeasonStats>()
      if (awaySP && awaySPStats) spStats.set(awaySP.id, awaySPStats)
      if (homeSP && homeSPStats) spStats.set(homeSP.id, homeSPStats)

      const toSummary = (
        sp: { id: number; fullName: string } | undefined,
        starter: typeof matchup.away.starter,
        hand: 'R' | 'L' | undefined,
        ps: PitcherSeasonStats | undefined,
      ): NrfiStarterSummary | null => {
        if (!sp) return null
        return {
          id:       sp.id,
          name:     sp.fullName,
          hand:     hand ?? '?',
          era:      starter?.era   ?? '-.--',
          whip:     starter?.whip  ?? '-.--',
          kRate:    starter?.spKRate  ?? null,
          bbRate:   starter?.spBBRate ?? null,
          xfip:     ps?.xfip && ps.xfip > 0 ? ps.xfip : null,
          i01Games: starter?.gamesPlayed ?? 0,
        }
      }

      return {
        gamePk:        g.gamePk,
        gameDate:      g.gameDate,
        awayTeamId:    awayId,
        homeTeamId:    homeId,
        awayTeamName:  g.teams.away.team.name,
        homeTeamName:  g.teams.home.team.name,
        awayStarter:   toSummary(awaySP, matchup.away.starter, awayHand, awaySPStats),
        homeStarter:   toSummary(homeSP, matchup.home.starter, homeHand, homeSPStats),
        pitcherScore:  Math.round(pitcherScore),
        lineupScore:   Math.round(lineupScore),
        trendScore:    Math.round(trendScore),
        contextScore:  Math.round(contextScore),
        nrfiScore,
        yrfiScore:     100 - nrfiScore,
        confidence:    computeConfidence(matchup, awayConf, homeConf),
        topSignals:    buildSignals(matchup, spStats, homeId, weather),
        weather,
        parkName:      park.name,
        parkFactor:    park.factor,
      } satisfies NrfiGameRanking
    }))

    for (const r of batchResults) {
      if (r) rankings.push(r)
    }
  }

  return rankings
}

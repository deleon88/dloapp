import { mlbApi } from '../client'
import type { LineupSlot } from './boxscore'

type HandCode = 'L' | 'R'
type SplitCode = 'i01' | 'vl' | 'vr'

export interface FirstInningHittingStats {
  runs: number
  hits: number
  homeRuns: number
  strikeOuts: number
  baseOnBalls: number
  atBats: number
  plateAppearances: number
  avg: string
  obp: string
  slg: string
  ops: string
}

export interface FirstInningPitchingStats {
  runs: number
  hits: number
  homeRuns: number
  strikeOuts: number
  baseOnBalls: number
  earnedRuns: number
  battersFaced: number
  inningsPitched: string
  era: string
  whip: string
}

export interface StarterFirstInningStats extends FirstInningPitchingStats {
  id: number
  fullName: string
  pitchHand?: HandCode
  gamesPlayed: number
}

export interface LineupSplitStats {
  code: SplitCode
  label: string
  avg: string
  obp: string
  slg: string
  ops: string
  plateAppearances: number
  homeRuns: number
  strikeOuts: number
  baseOnBalls: number
}

export interface FirstInningLineupPlayer {
  id: number
  fullName: string
  batSide?: HandCode
  firstInning: LineupSplitStats | null
  vsHand: LineupSplitStats | null
}

export interface FirstInningTrendGame {
  gamePk: number
  gameDate: string
  side: 'away' | 'home'
  opponentId: number
  opponentName: string
  scored: number
  allowed: number
  nrfi: boolean
  yrfi: boolean
}

export interface FirstInningTrendSummary {
  seasonGames: number
  scoredGames: number
  allowedGames: number
  nrfiGames: number
  yrfiGames: number
  scoredRate: number
  allowedRate: number
  nrfiRate: number
  yrfiRate: number
  avgRunsScored: number
  avgRunsAllowed: number
  currentScoredStreak: number
  currentScorelessStreak: number
  currentAllowedStreak: number
  currentNoRunAllowedStreak: number
  currentNrfiStreak: number
  currentYrfiStreak: number
  recentFiveScoredGames: number
  recentFiveAllowedGames: number
  recentFiveNrfiGames: number
  recentGames: FirstInningTrendGame[]
}

export interface NrfiTeamSnapshot {
  teamId: number
  offense: FirstInningHittingStats | null
  pitching: FirstInningPitchingStats | null
  starter: StarterFirstInningStats | null
  trend: FirstInningTrendSummary
  lineup: FirstInningLineupPlayer[]
}

export interface NrfiMatchupData {
  away: NrfiTeamSnapshot
  home: NrfiTeamSnapshot
}

export interface FetchNrfiMatchupParams {
  awayTeamId: number
  homeTeamId: number
  awayStarterId?: number
  homeStarterId?: number
  awayStarterHand?: string
  homeStarterHand?: string
  awayLineup: LineupSlot[]
  homeLineup: LineupSlot[]
  season?: number
  endDate?: string
}

interface RawTeamStatsResponse {
  stats?: Array<{
    splits?: Array<{
      stat?: Record<string, unknown>
    }>
  }>
}

interface RawPitcherResponse {
  people?: Array<{
    id: number
    fullName: string
    pitchHand?: { code?: string }
    stats?: Array<{
      splits?: Array<{
        stat?: Record<string, unknown>
      }>
    }>
  }>
}

interface RawLineupResponse {
  people?: Array<{
    id: number
    fullName: string
    batSide?: { code?: string }
    stats?: Array<{
      splits?: Array<{
        stat?: Record<string, unknown>
        split?: { code?: string; description?: string }
      }>
    }>
  }>
}

interface RawScheduleResponse {
  dates?: Array<{
    games?: RawScheduleGame[]
  }>
}

interface RawScheduleGame {
  gamePk: number
  gameDate: string
  status?: { abstractGameState?: string }
  teams: {
    away: { team: { id: number; name: string } }
    home: { team: { id: number; name: string } }
  }
  linescore?: {
    innings?: Array<{
      num: number
      away?: { runs?: number }
      home?: { runs?: number }
    }>
  }
}

export async function fetchNrfiMatchup({
  awayTeamId,
  homeTeamId,
  awayStarterId,
  homeStarterId,
  awayStarterHand,
  homeStarterHand,
  awayLineup,
  homeLineup,
  season = new Date().getFullYear(),
  endDate = todayIso(),
}: FetchNrfiMatchupParams): Promise<NrfiMatchupData> {
  const starterIds = [awayStarterId, homeStarterId].filter((id): id is number => id != null)

  const [
    awayTeamStats,
    homeTeamStats,
    awayTrend,
    homeTrend,
    starterMap,
    awayLineupStats,
    homeLineupStats,
  ] = await Promise.all([
    fetchTeamFirstInningStats(awayTeamId, season),
    fetchTeamFirstInningStats(homeTeamId, season),
    fetchTeamFirstInningTrend(awayTeamId, season, endDate),
    fetchTeamFirstInningTrend(homeTeamId, season, endDate),
    fetchStarterFirstInningStats(starterIds, season),
    fetchLineupFirstInningStats(awayLineup, normalizeHandCode(homeStarterHand), season),
    fetchLineupFirstInningStats(homeLineup, normalizeHandCode(awayStarterHand), season),
  ])

  return {
    away: {
      teamId: awayTeamId,
      offense: awayTeamStats.offense,
      pitching: awayTeamStats.pitching,
      starter: awayStarterId != null ? (starterMap.get(awayStarterId) ?? null) : null,
      trend: awayTrend,
      lineup: awayLineupStats,
    },
    home: {
      teamId: homeTeamId,
      offense: homeTeamStats.offense,
      pitching: homeTeamStats.pitching,
      starter: homeStarterId != null ? (starterMap.get(homeStarterId) ?? null) : null,
      trend: homeTrend,
      lineup: homeLineupStats,
    },
  }
}

async function fetchTeamFirstInningStats(teamId: number, season: number): Promise<{
  offense: FirstInningHittingStats | null
  pitching: FirstInningPitchingStats | null
}> {
  const [offense, pitching] = await Promise.all([
    fetchTeamFirstInningOffense(teamId, season),
    fetchTeamFirstInningPitching(teamId, season),
  ])

  return { offense, pitching }
}

async function fetchTeamFirstInningOffense(
  teamId: number,
  season: number,
): Promise<FirstInningHittingStats | null> {
  const data = await mlbApi.get<RawTeamStatsResponse>(`/teams/${teamId}/stats`, {
    group: 'hitting',
    stats: 'statSplits',
    sitCodes: 'i01',
    season,
    sportIds: 1,
    gameType: 'R',
    fields: [
      'stats',
      'splits',
      'stat',
      'avg',
      'obp',
      'slg',
      'ops',
      'runs',
      'hits',
      'homeRuns',
      'strikeOuts',
      'baseOnBalls',
      'atBats',
      'plateAppearances',
    ].join(','),
  })

  const stat = data.stats?.[0]?.splits?.[0]?.stat
  if (!stat) return null

  const s = stat as {
    runs?: number
    hits?: number
    homeRuns?: number
    strikeOuts?: number
    baseOnBalls?: number
    atBats?: number
    plateAppearances?: number
    avg?: string
    obp?: string
    slg?: string
    ops?: string
  }

  return {
    runs: s.runs ?? 0,
    hits: s.hits ?? 0,
    homeRuns: s.homeRuns ?? 0,
    strikeOuts: s.strikeOuts ?? 0,
    baseOnBalls: s.baseOnBalls ?? 0,
    atBats: s.atBats ?? 0,
    plateAppearances: s.plateAppearances ?? 0,
    avg: s.avg ?? '.---',
    obp: s.obp ?? '.---',
    slg: s.slg ?? '.---',
    ops: s.ops ?? '.---',
  }
}

async function fetchTeamFirstInningPitching(
  teamId: number,
  season: number,
): Promise<FirstInningPitchingStats | null> {
  const data = await mlbApi.get<RawTeamStatsResponse>(`/teams/${teamId}/stats`, {
    group: 'pitching',
    stats: 'statSplits',
    sitCodes: 'i01',
    season,
    sportIds: 1,
    gameType: 'R',
    fields: [
      'stats',
      'splits',
      'stat',
      'era',
      'whip',
      'hits',
      'runs',
      'earnedRuns',
      'homeRuns',
      'baseOnBalls',
      'strikeOuts',
      'inningsPitched',
      'battersFaced',
    ].join(','),
  })

  const stat = data.stats?.[0]?.splits?.[0]?.stat
  if (!stat) return null

  const s = stat as {
    runs?: number
    hits?: number
    homeRuns?: number
    strikeOuts?: number
    baseOnBalls?: number
    earnedRuns?: number
    battersFaced?: number
    inningsPitched?: string
    era?: string
    whip?: string
  }

  return {
    runs: s.runs ?? 0,
    hits: s.hits ?? 0,
    homeRuns: s.homeRuns ?? 0,
    strikeOuts: s.strikeOuts ?? 0,
    baseOnBalls: s.baseOnBalls ?? 0,
    earnedRuns: s.earnedRuns ?? 0,
    battersFaced: s.battersFaced ?? 0,
    inningsPitched: s.inningsPitched ?? '0.0',
    era: s.era ?? '-.--',
    whip: s.whip ?? '-.--',
  }
}

async function fetchStarterFirstInningStats(
  personIds: number[],
  season: number,
): Promise<Map<number, StarterFirstInningStats>> {
  if (!personIds.length) return new Map()

  const data = await mlbApi.get<RawPitcherResponse>('/people', {
    personIds: personIds.join(','),
    season,
    hydrate: `stats(group=[pitching],type=[statSplits],sitCodes=[i01],season=${season})`,
    fields: [
      'people',
      'id',
      'fullName',
      'pitchHand',
      'code',
      'stats',
      'splits',
      'stat',
      'era',
      'whip',
      'inningsPitched',
      'hits',
      'runs',
      'earnedRuns',
      'baseOnBalls',
      'strikeOuts',
      'homeRuns',
      'battersFaced',
      'gamesPlayed',
    ].join(','),
  })

  const map = new Map<number, StarterFirstInningStats>()
  for (const person of data.people ?? []) {
    const stat = person.stats?.[0]?.splits?.[0]?.stat as
      | {
          gamesPlayed?: number
          runs?: number
          homeRuns?: number
          strikeOuts?: number
          baseOnBalls?: number
          hits?: number
          era?: string
          inningsPitched?: string
          earnedRuns?: number
          whip?: string
          battersFaced?: number
        }
      | undefined

    if (!stat) continue

    map.set(person.id, {
      id: person.id,
      fullName: person.fullName,
      pitchHand: normalizeHandCode(person.pitchHand?.code),
      gamesPlayed: stat.gamesPlayed ?? 0,
      runs: stat.runs ?? 0,
      hits: stat.hits ?? 0,
      homeRuns: stat.homeRuns ?? 0,
      strikeOuts: stat.strikeOuts ?? 0,
      baseOnBalls: stat.baseOnBalls ?? 0,
      earnedRuns: stat.earnedRuns ?? 0,
      battersFaced: stat.battersFaced ?? 0,
      inningsPitched: stat.inningsPitched ?? '0.0',
      era: stat.era ?? '-.--',
      whip: stat.whip ?? '-.--',
    })
  }

  return map
}

async function fetchLineupFirstInningStats(
  lineup: LineupSlot[],
  opponentPitcherHand: HandCode | undefined,
  season: number,
): Promise<FirstInningLineupPlayer[]> {
  if (!lineup.length) return []

  const splitCodes: SplitCode[] = opponentPitcherHand === 'L' ? ['i01', 'vl'] : opponentPitcherHand === 'R' ? ['i01', 'vr'] : ['i01']
  const data = await mlbApi.get<RawLineupResponse>('/people', {
    personIds: lineup.map((player) => player.id).join(','),
    season,
    hydrate: `stats(group=[hitting],type=[statSplits],sitCodes=[${splitCodes.join(',')}],season=${season})`,
    fields: [
      'people',
      'id',
      'fullName',
      'batSide',
      'code',
      'stats',
      'type',
      'displayName',
      'splits',
      'split',
      'code',
      'description',
      'stat',
      'avg',
      'obp',
      'slg',
      'ops',
      'plateAppearances',
      'homeRuns',
      'strikeOuts',
      'baseOnBalls',
    ].join(','),
  })

  const players = new Map<number, FirstInningLineupPlayer>()
  for (const person of data.people ?? []) {
    const splits = person.stats?.[0]?.splits ?? []
    const firstInning = toLineupSplit(splits.find((split) => split.split?.code === 'i01'))
    const vsHandCode = opponentPitcherHand === 'L' ? 'vl' : opponentPitcherHand === 'R' ? 'vr' : null
    const vsHand = vsHandCode ? toLineupSplit(splits.find((split) => split.split?.code === vsHandCode)) : null

    players.set(person.id, {
      id: person.id,
      fullName: person.fullName,
      batSide: normalizeHandCode(person.batSide?.code),
      firstInning,
      vsHand,
    })
  }

  return lineup.map((player) => (
    players.get(player.id) ?? {
      id: player.id,
      fullName: player.fullName,
      firstInning: null,
      vsHand: null,
    }
  ))
}

async function fetchTeamFirstInningTrend(
  teamId: number,
  season: number,
  endDate: string,
): Promise<FirstInningTrendSummary> {
  const data = await mlbApi.get<RawScheduleResponse>('/schedule', {
    teamId,
    sportId: 1,
    gameType: 'R',
    startDate: `${season}-03-01`,
    endDate,
    hydrate: 'linescore',
    fields: [
      'dates',
      'games',
      'gamePk',
      'gameDate',
      'status',
      'abstractGameState',
      'teams',
      'away',
      'home',
      'team',
      'id',
      'name',
      'linescore',
      'innings',
      'num',
      'away',
      'home',
      'runs',
    ].join(','),
  })

  const logs: FirstInningTrendGame[] = []
  for (const date of data.dates ?? []) {
    for (const game of date.games ?? []) {
      if (game.status?.abstractGameState !== 'Final') continue

      const side = game.teams.away.team.id === teamId ? 'away' : game.teams.home.team.id === teamId ? 'home' : null
      if (!side) continue

      const first = game.linescore?.innings?.find((inning) => inning.num === 1)
      if (!first) continue

      const scored = side === 'away' ? first.away?.runs ?? 0 : first.home?.runs ?? 0
      const allowed = side === 'away' ? first.home?.runs ?? 0 : first.away?.runs ?? 0
      const opponent = side === 'away' ? game.teams.home.team : game.teams.away.team

      logs.push({
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        side,
        opponentId: opponent.id,
        opponentName: opponent.name,
        scored,
        allowed,
        nrfi: scored === 0 && allowed === 0,
        yrfi: scored + allowed > 0,
      })
    }
  }

  const seasonGames = logs.length
  if (!seasonGames) {
    return emptyTrend()
  }

  const scoredGames = logs.filter((game) => game.scored > 0).length
  const allowedGames = logs.filter((game) => game.allowed > 0).length
  const nrfiGames = logs.filter((game) => game.nrfi).length
  const yrfiGames = logs.filter((game) => game.yrfi).length
  const recentFive = logs.slice(-5)

  return {
    seasonGames,
    scoredGames,
    allowedGames,
    nrfiGames,
    yrfiGames,
    scoredRate: ratio(scoredGames, seasonGames),
    allowedRate: ratio(allowedGames, seasonGames),
    nrfiRate: ratio(nrfiGames, seasonGames),
    yrfiRate: ratio(yrfiGames, seasonGames),
    avgRunsScored: average(logs.map((game) => game.scored)),
    avgRunsAllowed: average(logs.map((game) => game.allowed)),
    currentScoredStreak: streakFromEnd(logs, (game) => game.scored > 0),
    currentScorelessStreak: streakFromEnd(logs, (game) => game.scored === 0),
    currentAllowedStreak: streakFromEnd(logs, (game) => game.allowed > 0),
    currentNoRunAllowedStreak: streakFromEnd(logs, (game) => game.allowed === 0),
    currentNrfiStreak: streakFromEnd(logs, (game) => game.nrfi),
    currentYrfiStreak: streakFromEnd(logs, (game) => game.yrfi),
    recentFiveScoredGames: recentFive.filter((game) => game.scored > 0).length,
    recentFiveAllowedGames: recentFive.filter((game) => game.allowed > 0).length,
    recentFiveNrfiGames: recentFive.filter((game) => game.nrfi).length,
    recentGames: logs.slice(-5).reverse(),
  }
}

function toLineupSplit(
  split:
    | {
        stat?: Record<string, unknown>
        split?: { code?: string; description?: string }
      }
    | undefined,
): LineupSplitStats | null {
  const code = split?.split?.code
  if (code !== 'i01' && code !== 'vl' && code !== 'vr') return null
  if (!split) return null

  const stat = split.stat as
    | {
        avg?: string
        obp?: string
        slg?: string
        ops?: string
        plateAppearances?: number
        homeRuns?: number
        strikeOuts?: number
        baseOnBalls?: number
      }
    | undefined
  if (!stat) return null

  return {
    code,
    label: split.split?.description ?? defaultSplitLabel(code),
    avg: stat.avg ?? '.---',
    obp: stat.obp ?? '.---',
    slg: stat.slg ?? '.---',
    ops: stat.ops ?? '.---',
    plateAppearances: stat.plateAppearances ?? 0,
    homeRuns: stat.homeRuns ?? 0,
    strikeOuts: stat.strikeOuts ?? 0,
    baseOnBalls: stat.baseOnBalls ?? 0,
  }
}

function defaultSplitLabel(code: SplitCode): string {
  switch (code) {
    case 'i01':
      return 'First Inning'
    case 'vl':
      return 'vs Left'
    case 'vr':
      return 'vs Right'
  }
}

function normalizeHandCode(code: string | undefined): HandCode | undefined {
  return code === 'L' || code === 'R' ? code : undefined
}

function ratio(value: number, total: number): number {
  return total > 0 ? value / total : 0
}

function average(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function streakFromEnd(
  values: FirstInningTrendGame[],
  predicate: (game: FirstInningTrendGame) => boolean,
): number {
  let streak = 0
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (!predicate(values[index])) break
    streak += 1
  }
  return streak
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function emptyTrend(): FirstInningTrendSummary {
  return {
    seasonGames: 0,
    scoredGames: 0,
    allowedGames: 0,
    nrfiGames: 0,
    yrfiGames: 0,
    scoredRate: 0,
    allowedRate: 0,
    nrfiRate: 0,
    yrfiRate: 0,
    avgRunsScored: 0,
    avgRunsAllowed: 0,
    currentScoredStreak: 0,
    currentScorelessStreak: 0,
    currentAllowedStreak: 0,
    currentNoRunAllowedStreak: 0,
    currentNrfiStreak: 0,
    currentYrfiStreak: 0,
    recentFiveScoredGames: 0,
    recentFiveAllowedGames: 0,
    recentFiveNrfiGames: 0,
    recentGames: [],
  }
}

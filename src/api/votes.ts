// Client for game votes, pick history and the picks leaderboard
// (api/votes.ts, api/votes/history.ts, api/rankings.ts).
import { supabase } from '@/lib/supabase'

export interface GameVotes {
  counts: Record<string, number>   // teamId → votes
  total: number
  myVote: number | null
}

export type PickResult = 'won' | 'lost' | 'pending' | 'void'

export interface Pick {
  gamePk: number
  date: string
  gameTime: string | null
  awayTeamId: number
  homeTeamId: number
  awayScore: number | null
  homeScore: number | null
  teamId: number
  result: PickResult
}

export interface PickSummary {
  won: number
  lost: number
  pending: number
  pct: number | null
  streak: { kind: 'won' | 'lost'; n: number } | null
  bestStreak: number
}

export interface PickHistory {
  picks: Pick[]
  summary: PickSummary
}

export type RankingPeriod = 'today' | 'week' | 'month' | 'season'

export interface RankingRow {
  rank: number
  username: string
  favoriteTeamId: number | null
  correct: number
  decided: number
  pct: number
  streak: number          // current run of correct picks
}

export interface Rankings {
  period: RankingPeriod
  from: string
  to: string
  rows: RankingRow[]
}

export class VoteError extends Error {
  constructor(public code: string) { super(code) }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new VoteError((body as { error?: string }).error ?? `http_${res.status}`)
  return body as T
}

export async function fetchGameVotes(gamePk: number): Promise<GameVotes> {
  return json(await fetch(`/api/votes?game=${gamePk}`, { headers: await authHeaders() }))
}

export async function castVote(gamePk: number, teamId: number): Promise<GameVotes> {
  return json(await fetch('/api/votes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ game: gamePk, team: teamId }),
  }))
}

export async function fetchPickHistory(): Promise<PickHistory> {
  return json(await fetch('/api/votes/history', { headers: await authHeaders() }))
}
export async function fetchRankings(period: RankingPeriod): Promise<Rankings> {
  return json(await fetch(`/api/rankings?period=${period}`))
}

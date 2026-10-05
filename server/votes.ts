// Game votes ("who wins?") and the picks leaderboard.
//   - A vote can be cast or changed until the game starts (checked live with MLB).
//   - A pick counts once the game is final: right if the team won. Postponed or
//     cancelled games don't count.
import { sql } from './db.js'
import { getJson } from './mlb/pbp.js'
import { etDate, syncSchedule, upsertGames } from './ingest.js'
import type { ScheduleGame } from './mlb/pbp.js'
import { periodRange, type RankingPeriod } from './rankingPeriod.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

// ── Results freshness ───────────────────────────────────────────────────────
// The daily cron fills results the next morning; picks and rankings refresh
// yesterday's and today's results on demand, at most every few minutes.
let lastRefresh = 0
export async function refreshRecentResults(): Promise<void> {
  if (Date.now() - lastRefresh < 3 * 60_000) return
  lastRefresh = Date.now()
  await syncSchedule(etDate(new Date(Date.now() - 86_400_000)), etDate()).catch(() => { lastRefresh = 0 })
}

// ── Casting a vote ──────────────────────────────────────────────────────────

export type VoteError = 'game_not_found' | 'invalid_team' | 'voting_closed'

/** Saves (or changes) the user's pick, if the game hasn't started. */
export async function castVote(userId: string, gamePk: number, teamId: number): Promise<VoteError | null> {
  // Live status from MLB: a delayed game stays open, one that started doesn't.
  const data = await getJson<{ dates?: Array<{ games?: Array<{
    gamePk: number; gameType: string; gameDate?: string; officialDate: string; season?: string
    status?: { abstractGameState?: string; detailedState?: string }
    teams?: { away?: { team?: { id?: number } }; home?: { team?: { id?: number } } }
    venue?: { id?: number }
  }> }> }>(
    `${MLB_API}/schedule?gamePk=${gamePk}&fields=dates,games,gamePk,gameType,gameDate,officialDate,season,status,abstractGameState,detailedState,teams,away,home,team,id,venue`,
  )
  const g = data.dates?.flatMap(d => d.games ?? []).find(x => x.gamePk === gamePk)
  if (!g) return 'game_not_found'
  const away = g.teams?.away?.team?.id, home = g.teams?.home?.team?.id
  if (teamId !== away && teamId !== home) return 'invalid_team'
  const state = g.status?.abstractGameState
  const dead = ['Postponed', 'Cancelled', 'Suspended'].some(s => (g.status?.detailedState ?? '').startsWith(s))
  if (state !== 'Preview' || dead) return 'voting_closed'

  // The game row may not exist yet (the cron syncs a few days at a time).
  const row: ScheduleGame = {
    game_pk: g.gamePk, season: Number(g.season ?? g.officialDate.slice(0, 4)), game_date: g.officialDate,
    game_type: g.gameType, abstract_state: state, status: g.status?.detailedState ?? 'Scheduled',
    away_team_id: away!, home_team_id: home!, venue_id: g.venue?.id ?? null,
    game_time: g.gameDate ?? null, away_score: null, home_score: null, winner_team_id: null,
  }
  await upsertGames([row])
  await sql`
    INSERT INTO votes (user_id, game_pk, team_id) VALUES (${userId}, ${gamePk}, ${teamId})
    ON CONFLICT (user_id, game_pk) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = now()
  `
  return null
}

// ── Reading votes ───────────────────────────────────────────────────────────

export interface GameVotes {
  counts: Record<string, number>   // teamId → votes
  total: number
  myVote: number | null
}

export async function getGameVotes(gamePk: number, userId: string | null): Promise<GameVotes> {
  const rows = await sql<{ team_id: number; n: number }[]>`
    SELECT team_id, count(*)::int AS n FROM votes WHERE game_pk = ${gamePk} GROUP BY team_id`
  const [mine] = userId
    ? await sql<{ team_id: number }[]>`SELECT team_id FROM votes WHERE game_pk = ${gamePk} AND user_id = ${userId}`
    : []
  return {
    counts: Object.fromEntries(rows.map(r => [r.team_id, r.n])),
    total: rows.reduce((s, r) => s + r.n, 0),
    myVote: mine?.team_id ?? null,
  }
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

const pickResult = (status: string, state: string, winner: number | null, team: number): PickResult =>
  /^(Postponed|Cancelled)/.test(status) ? 'void'
    : state !== 'Final' ? 'pending'
    : winner == null ? 'void'
    : winner === team ? 'won' : 'lost'

/** The user's picks, newest first. */
export async function getPickHistory(userId: string, limit = 60): Promise<Pick[]> {
  const rows = await sql<Array<{
    game_pk: number; game_date: string; game_time: Date | null; away_team_id: number; home_team_id: number
    away_score: number | null; home_score: number | null; winner_team_id: number | null
    status: string; abstract_state: string; team_id: number
  }>>`
    SELECT g.game_pk, to_char(g.game_date, 'YYYY-MM-DD') AS game_date, g.game_time, g.away_team_id, g.home_team_id,
           g.away_score, g.home_score, g.winner_team_id, g.status, g.abstract_state, v.team_id
    FROM votes v JOIN games g USING (game_pk)
    WHERE v.user_id = ${userId}
    ORDER BY g.game_date DESC, g.game_time DESC NULLS LAST
    LIMIT ${limit}
  `
  return rows.map(r => ({
    gamePk: r.game_pk, date: r.game_date, gameTime: r.game_time?.toISOString() ?? null,
    awayTeamId: r.away_team_id, homeTeamId: r.home_team_id,
    awayScore: r.away_score, homeScore: r.home_score, teamId: r.team_id,
    result: pickResult(r.status, r.abstract_state, r.winner_team_id, r.team_id),
  }))
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

export type { RankingPeriod }

export interface RankingRow {
  rank: number
  username: string
  favoriteTeamId: number | null
  correct: number
  decided: number
  pct: number            // correct / decided, 0–100
}

/**
 * Picks leaderboard: most correct picks first; ties broken by hit rate, then
 * fewer picks (same hits with fewer misses ranks higher). Tied users share a rank.
 */
export async function getRankings(period: RankingPeriod): Promise<{ from: string; to: string; rows: RankingRow[] }> {
  const { from, to } = periodRange(period, etDate())
  const rows = await sql<Array<{ username: string; favorite_team_id: number | null; correct: number; decided: number; rank: number }>>`
    WITH tally AS (
      SELECT p.username, p.favorite_team_id,
             count(*) FILTER (WHERE v.team_id = g.winner_team_id)::int AS correct,
             count(*)::int AS decided
      FROM votes v
      JOIN games g USING (game_pk)
      JOIN profiles p ON p.id = v.user_id
      WHERE g.winner_team_id IS NOT NULL
        AND p.username IS NOT NULL
        AND g.game_date BETWEEN ${from} AND ${to}
      GROUP BY p.username, p.favorite_team_id
    )
    SELECT *, rank() OVER (ORDER BY correct DESC, correct::numeric / decided DESC, decided ASC)::int AS rank
    FROM tally
    ORDER BY rank, lower(username)
  `
  return {
    from, to,
    rows: rows.map(r => ({
      rank: r.rank, username: r.username, favoriteTeamId: r.favorite_team_id,
      correct: r.correct, decided: r.decided, pct: Math.round((r.correct / r.decided) * 100),
    })),
  }
}

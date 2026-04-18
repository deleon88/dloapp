import { mlbApi } from '../client'
import type { GumboFeed } from '@/api/gumbo/types'

// Live feed is on v1.1, not v1 — uses a separate proxy path
const MLB_V11_BASE = '/api/mlb-v11'

async function getV11<T>(path: string): Promise<T> {
  const res = await fetch(`${MLB_V11_BASE}${path}`)
  if (!res.ok) throw new Error(`MLB v1.1 API error: ${res.status} — ${path}`)
  return res.json() as Promise<T>
}

export function getLiveFeed(gamePk: number): Promise<GumboFeed> {
  return getV11<GumboFeed>(`/game/${gamePk}/feed/live`)
}

export function getLiveFeedDiff(gamePk: number, startTimecode: string): Promise<GumboFeed> {
  return getV11<GumboFeed>(`/game/${gamePk}/feed/live/diffPatch?startTimecode=${encodeURIComponent(startTimecode)}`)
}

export function getBoxscore(gamePk: number): Promise<unknown> {
  return mlbApi.get(`/game/${gamePk}/boxscore`)
}

export function getLinescores(gamePk: number): Promise<unknown> {
  return mlbApi.get(`/game/${gamePk}/linescore`)
}

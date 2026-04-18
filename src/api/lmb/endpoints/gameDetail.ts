import { lmbApi } from '../client'
import type { LmbDetailResponse, LmbGameDetail } from '../types'

export async function getLmbGameDetail(gameId: string): Promise<LmbGameDetail | null> {
  const data = await lmbApi.get<LmbDetailResponse>('/detail', { permalink: gameId })
  return data.games_info?.[0] ?? null
}

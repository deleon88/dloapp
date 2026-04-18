import type { GumboFeed } from './types'
import { getLiveFeed, getLiveFeedDiff } from '@/api/mlb/endpoints/game'

export type GumboListener = (feed: GumboFeed) => void

/**
 * Polls the GUMBO live feed at a configurable interval.
 * Uses the diffPatch endpoint after the first fetch to minimize data transfer.
 */
export class GumboPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private lastTimestamp: string | null = null
  private listeners: Set<GumboListener> = new Set()

  constructor(
    private gamePk: number,
    private pollIntervalMs = 10_000,
  ) {}

  start(): void {
    if (this.intervalId !== null) return
    void this.poll()
    this.intervalId = setInterval(() => void this.poll(), this.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  subscribe(listener: GumboListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async poll(): Promise<void> {
    try {
      const feed = this.lastTimestamp
        ? await getLiveFeedDiff(this.gamePk, this.lastTimestamp)
        : await getLiveFeed(this.gamePk)

      this.lastTimestamp = feed.metaData.timeStamp
      this.listeners.forEach((fn) => fn(feed))
    } catch (error) {
      console.error('[GumboPoller] poll failed:', error)
    }
  }
}

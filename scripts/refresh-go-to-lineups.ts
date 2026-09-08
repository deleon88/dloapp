/**
 * refresh-go-to-lineups.ts
 * =========================
 * Weekly (or divergence-triggered) refresh of each team's "go-to" lineup —
 * the stable, frequency-based predicted lineup shown while today's actual
 * lineup is still "projected" (not yet confirmed).
 *
 * Reuses predictedLineup.ts's existing algorithm directly instead of
 * reimplementing it in Python, so the browser's on-demand prediction and
 * this weekly server-side refresh never drift apart. It runs in Node via
 * tsx, not the browser, so localStorage (which goToLineupStore.ts normally
 * reads/writes) is shimmed below with an in-memory store, seeded from last
 * run's committed public/data/go_to_lineups.json — so the tiebreaker logic
 * that stabilizes predictions run-to-run still has something to compare
 * against across weekly runs, not just within a single run.
 *
 * Output: public/data/go_to_lineups.json — same shape as goToLineupStore's
 * internal GoToStore (teamId → {savedAt, vsRHP, vsLHP}). This is the shared,
 * server-computed replacement for what used to live only in each browser's
 * own localStorage — every user now reads the same file instead of each
 * independently (re)computing their own predictions.
 *
 * Usage:
 *   npx tsx scripts/refresh-go-to-lineups.ts
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const OUT_PATH = 'public/data/go_to_lineups.json'

// ── localStorage shim (Node has no browser storage) ────────────────────────
// Installed before main() runs; goToLineupStore.ts only touches `localStorage`
// inside function bodies (not at module-load time), so plain static imports
// below are safe even though they're hoisted above this assignment.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void { this.store.set(key, value) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null }
  get length(): number { return this.store.size }
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage()

import { getTeams } from '../src/api/mlb/endpoints/teams.ts'
import { fetchTeamPredictionsNoDepth } from '../src/api/mlb/endpoints/predictedLineup.ts'
import { STORE_KEY, exportGoToLineupsJSON } from '../src/api/mlb/endpoints/goToLineupStore.ts'

async function main() {
  // Seed from last run's committed snapshot, if any, so the tiebreaker that
  // stabilizes predictions across runs has something to compare against.
  if (existsSync(OUT_PATH)) {
    localStorage.setItem(STORE_KEY, readFileSync(OUT_PATH, 'utf-8'))
    console.log(`Seeded from existing ${OUT_PATH}`)
  }

  const { teams } = await getTeams({ sportId: 1 })
  const teamIds = teams.map(t => t.id)
  console.log(`Refreshing go-to lineups for ${teamIds.length} teams...`)

  // Small concurrency window — each team's prediction makes several MLB API
  // calls (schedule, ~10 boxscores, depth chart, pitch hands).
  const CONCURRENCY = 4
  let done = 0
  for (let i = 0; i < teamIds.length; i += CONCURRENCY) {
    const batch = teamIds.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async id => {
      try {
        // Writes the result into the shimmed localStorage internally (same
        // setGoToLineup() call path the browser uses).
        await fetchTeamPredictionsNoDepth(id)
      } catch (e) {
        console.error(`  team ${id} failed:`, e)
      }
      done++
      if (done % 6 === 0 || done === teamIds.length) console.log(`  ${done}/${teamIds.length} teams done`)
    }))
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, exportGoToLineupsJSON())
  console.log(`\nWrote ${OUT_PATH}`)
}

main().catch(e => { console.error(e); process.exit(1) })

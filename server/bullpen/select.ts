// Who is likely to pitch out of the bullpen today. Pure function, same rules
// the game page used to run in the browser (tests/unit/bullpen.test.ts).

export interface Appearance {
  date: string        // official (ET) game date, YYYY-MM-DD
  pitches: number
  isStarter: boolean
}

export interface DepthChartArm {
  id: number
  isCloser: boolean
  order: number       // position among the relievers on the depth chart
}

export interface SelectionInput {
  /** Active relievers on the depth chart (closer and the "P" slots). */
  depthChart: DepthChartArm[]
  injured: Set<number>
  /** Season pLI (leverage) per pitcher, from MLB's relief sabermetrics. */
  pli: Map<number, number>
  /** Appearances in the team's last completed games before today, oldest first. */
  usage: Map<number, Appearance[]>
  gamesPlayed: number
  today: string
  yesterday: string
  twoDaysAgo: string
}

const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

function restScore(days: number): number {
  if (days >= 99) return 0
  if (days === 2) return 20
  if (days === 3) return 18
  if (days === 1) return 12
  if (days === 4) return 10
  return 5
}

/**
 * Up to `limit` arms ranked by how likely they are to pitch today:
 * leverage (pLI) + recent relief frequency + rest + closer role + depth chart
 * order. Leaves out injured arms, starters, bulk relievers (> 50 pitches per
 * relief outing) and anyone over the pitch gate (> 30 yesterday or ≥ 50 in
 * the last two days).
 */
export function selectBullpen(input: SelectionInput, limit = 8): Array<{ id: number; score: number }> {
  const dc = new Map(input.depthChart.map(a => [a.id, a]))
  const candidates = new Set<number>(dc.keys())
  for (const [id, apps] of input.usage) if (apps.some(a => !a.isStarter)) candidates.add(id)

  const scored: Array<{ id: number; score: number }> = []
  for (const id of candidates) {
    if (input.injured.has(id)) continue
    const apps = input.usage.get(id) ?? []
    const relief = apps.filter(a => !a.isStarter)
    const onDepthChart = dc.get(id)
    if (!relief.length && !onDepthChart) continue
    if (apps.length && apps.every(a => a.isStarter)) continue
    if (relief.length && relief.reduce((s, a) => s + a.pitches, 0) / relief.length > 50) continue

    const last = apps[apps.length - 1]?.date
    const rest = last ? daysBetween(last, input.today) : 99
    const yesterday = apps.filter(a => a.date === input.yesterday).reduce((s, a) => s + a.pitches, 0)
    const lastTwo = apps.filter(a => a.date >= input.twoDaysAgo).reduce((s, a) => s + a.pitches, 0)
    if (yesterday > 30 || lastTwo >= 50) continue

    const pli = input.pli.get(id) ?? 0
    const frequency = input.gamesPlayed > 0 ? relief.length / input.gamesPlayed : 0
    const dcBonus = onDepthChart ? Math.max(0, 10 - onDepthChart.order * 0.8) : 0
    const score = Math.min(pli * 30, 40) + frequency * 25 + restScore(rest)
      + (onDepthChart?.isCloser ? 15 : 0) + dcBonus
    scored.push({ id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

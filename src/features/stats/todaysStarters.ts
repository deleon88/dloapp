// "Today's starters" for the Stats page: the probable pitchers of today's games
// and the nine batters each team starts — the posted lineup (boxscore), or the
// go-to lineup vs the other starter's hand while it isn't posted yet.
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { getStartingBattingOrders } from '@/api/mlb/endpoints/boxscore'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { fetchGoToLineups, goToFor } from '@/api/lineups'
import { mlbToday } from '@/utils/etDate'

export interface TodaysStarters {
  date: string
  pitchers: Set<number>
  batters: Set<number>
}

interface Probable { probablePitcher?: { id: number } }

export async function fetchTodaysStarters(): Promise<TodaysStarters> {
  const date = mlbToday()
  const schedule = await getSchedule({ date, hydrate: ['probablePitcher'] })
  // Postponed / cancelled games don't start anyone
  const games = (schedule.dates?.[0]?.games ?? [])
    .filter(g => g.status.detailedState !== 'Postponed' && g.status.detailedState !== 'Cancelled')

  const pitchers = new Set<number>()
  const probables = games.map(g => {
    const away = (g.teams.away as Probable).probablePitcher?.id
    const home = (g.teams.home as Probable).probablePitcher?.id
    if (away) pitchers.add(away)
    if (home) pitchers.add(home)
    return { away, home }
  })

  const teamIds = [...new Set(games.flatMap(g => [g.teams.away.team.id, g.teams.home.team.id]))]
  const [orders, goTo, hands] = await Promise.all([
    Promise.all(games.map(g => getStartingBattingOrders(g.gamePk).catch(() => ({ away: [], home: [] })))),
    teamIds.length ? fetchGoToLineups(teamIds).catch(() => new Map()) : Promise.resolve(new Map()),
    pitchers.size ? getPitchHands([...pitchers]).catch(() => new Map<number, string>()) : Promise.resolve(new Map<number, string>()),
  ])

  const batters = new Set<number>()
  games.forEach((g, i) => {
    for (const side of ['away', 'home'] as const) {
      const posted = orders[i][side]
      const opposing = probables[i][side === 'away' ? 'home' : 'away']
      const ids = posted.length
        ? posted
        : (goToFor(goTo.get(g.teams[side].team.id), opposing ? hands.get(opposing) : undefined) ?? []).map(p => p.id)
      ids.forEach(id => batters.add(id))
    }
  })
  return { date, pitchers, batters }
}

// Descarga y normalización del play-by-play de MLB.
// Port de fetch_game_plays() de scripts/compute_linear_weights.py (rama
// hand-splits-stat-fixes): misma lógica de outs y bases, para que las
// constantes RE24 calculadas en SQL den lo mismo que el script de Python.

const MLB_API = 'https://statsapi.mlb.com/api/v1'

// Solo los campos que usamos: ~32 KB por juego en lugar de ~560 KB.
const PBP_FIELDS = [
  'allPlays', 'result', 'event', 'eventType', 'rbi',
  'about', 'atBatIndex', 'inning', 'halfInning', 'isComplete',
  'count', 'outs', 'matchup', 'batter', 'pitcher', 'id', 'pitchHand', 'batSide', 'code',
  'runners', 'movement', 'originBase', 'end',
  'playEvents', 'hitData', 'trajectory',
  // Mid-PA pitching changes (rule 9.16(h), see responsiblePitcher).
  'isPitch', 'balls', 'strikes', 'details', 'isSubstitution', 'position', 'abbreviation', 'player',
].join(',')

export const PA_EVENTS = new Set([
  'Walk', 'Intent Walk', 'Hit By Pitch',
  'Single', 'Double', 'Triple', 'Home Run',
  'Strikeout', 'Groundout', 'Flyout', 'Lineout', 'Pop Out',
  // El script de Python no los incluía: son los 333 turnos que faltaban
  // contra el total oficial de MLB en 2026.
  'Bunt Groundout', 'Bunt Pop Out', 'Bunt Lineout',
  'Forceout', 'Grounded Into DP', 'Double Play', 'Triple Play',
  'Strikeout Double Play',
  'Fielders Choice', 'Fielders Choice Out',
  'Sac Fly', 'Sac Fly Double Play',
  'Sac Bunt', 'Sac Bunt Double Play',
  'Catcher Interference', 'Batter Interference', 'Field Error',
])

export interface PlayRow {
  game_pk: number
  at_bat_index: number
  game_date: string
  inning: number
  half: 't' | 'b'
  batter_id: number | null
  pitcher_id: number | null
  bat_side: string | null
  pitch_hand: string | null
  event: string
  event_type: string | null
  is_pa: boolean
  pre_outs: number
  on_1b: boolean
  on_2b: boolean
  on_3b: boolean
  runs_scored: number
  outs_recorded: number
  rbi: number
  trajectory: string | null
}

interface RawPlay {
  result?: { event?: string; eventType?: string; rbi?: number }
  about?: { atBatIndex?: number; inning?: number; halfInning?: string }
  count?: { outs?: number }
  matchup?: {
    batter?: { id?: number }
    pitcher?: { id?: number }
    batSide?: { code?: string }
    pitchHand?: { code?: string }
  }
  runners?: Array<{ movement?: { originBase?: string | null; end?: string | null } }>
  playEvents?: Array<{
    hitData?: { trajectory?: string }
    isPitch?: boolean
    count?: { balls?: number; strikes?: number }
    details?: { eventType?: string }
    isSubstitution?: boolean
    position?: { abbreviation?: string }
    player?: { id?: number }
  }>
}

const WALKS = new Set(['Walk', 'Intent Walk'])

/**
 * Pitcher charged with the plate appearance (id only; the hand is looked up
 * afterwards). Official scoring rule 9.16(h): when the pitcher is changed
 * mid-PA with the count at 2-0, 2-1, 3-0, 3-1 or 3-2 and the batter walks, the
 * batter and the walk go to the pitcher who was replaced. Anything else the
 * batter does goes to the reliever. With several changes in one PA, the last
 * one decides. `previous` is the pitcher on the mound for the fielding side
 * before this play.
 */
function responsiblePitcherId(play: RawPlay, event: string, current: number | null, previous: number | undefined): number | null {
  if (!WALKS.has(event)) return current
  const events = play.playEvents ?? []
  const changes = events.flatMap((e, i) =>
    e.details?.eventType === 'pitching_substitution' || (e.isSubstitution && e.position?.abbreviation === 'P') ? [i] : [])
  if (!changes.length) return current
  const last = changes[changes.length - 1]
  const lastPitch = events.slice(0, last).filter(e => e.isPitch).pop()
  const balls = lastPitch?.count?.balls ?? 0
  const strikes = lastPitch?.count?.strikes ?? 0
  if (!(balls === 3 || (balls === 2 && strikes <= 1))) return current
  // Replaced pitcher: whoever entered at the previous change in this PA, or
  // the pitcher who started it.
  const replaced = changes.length > 1 ? events[changes[changes.length - 2]].player?.id : previous
  return replaced ?? current
}

export async function getJson<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dloapp-pipeline/1.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      if (attempt >= retries - 1) throw new Error(`${url}: ${(e as Error).message}`)
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
}

const BASES = new Set(['1B', '2B', '3B'])

/**
 * Nuevas bases y carreras a partir de los movimientos de corredores.
 * Los corredores que no se mueven no aparecen en `runners`, así que se
 * conservan; si un corredor tiene varios movimientos, gana el último `end`.
 */
function updateBases(current: Set<string>, runners: NonNullable<RawPlay['runners']>) {
  const lastEnd = new Map<string | null | undefined, string | null | undefined>()
  for (const r of runners) lastEnd.set(r.movement?.originBase, r.movement?.end)

  const next = new Set(current)
  for (const origin of lastEnd.keys()) if (origin && BASES.has(origin)) next.delete(origin)
  let runs = 0
  for (const end of lastEnd.values()) {
    if (end && BASES.has(end)) next.add(end)
    if (end === 'score') runs++
  }
  return { next, runs }
}

export function parsePlays(gamePk: number, gameDate: string, allPlays: RawPlay[]): PlayRow[] {
  const rows: PlayRow[] = []
  let prevOuts = 0
  let bases = new Set<string>()
  let curInning: number | null = null
  let curHalf: string | null = null
  // Last pitcher on the mound for each fielding side (top half = home pitches).
  const lastPitcher = new Map<string, number>()
  // Throwing hand of every pitcher that appears in a matchup in this game.
  const hands = new Map<number, string>()
  for (const p of allPlays) {
    const id = p.matchup?.pitcher?.id
    if (id && p.matchup?.pitchHand?.code) hands.set(id, p.matchup.pitchHand.code)
  }

  for (const play of allPlays) {
    const inning = play.about?.inning ?? 0
    const half = play.about?.halfInning ?? ''
    if (inning !== curInning || half !== curHalf) {
      prevOuts = 0
      bases = new Set()
      curInning = inning
      curHalf = half
    }

    const postOuts = play.count?.outs ?? prevOuts
    const event = (play.result?.event ?? '').trim()
    const { next, runs } = updateBases(bases, play.runners ?? [])
    const onMound = play.matchup?.pitcher?.id ?? null
    const charged = responsiblePitcherId(play, event, onMound, lastPitcher.get(half))
    if (onMound) lastPitcher.set(half, onMound)

    rows.push({
      game_pk: gamePk,
      at_bat_index: play.about?.atBatIndex ?? rows.length,
      game_date: gameDate,
      inning,
      half: half === 'bottom' ? 'b' : 't',
      batter_id: play.matchup?.batter?.id ?? null,
      pitcher_id: charged,
      bat_side: play.matchup?.batSide?.code ?? null,
      // null only for a pitcher with no matchup of his own in the game; fetchGamePlays fills it in.
      pitch_hand: charged === onMound ? play.matchup?.pitchHand?.code ?? null : (charged && hands.get(charged)) || null,
      event,
      event_type: play.result?.eventType ?? null,
      is_pa: PA_EVENTS.has(event),
      pre_outs: prevOuts,
      on_1b: bases.has('1B'),
      on_2b: bases.has('2B'),
      on_3b: bases.has('3B'),
      runs_scored: runs,
      outs_recorded: postOuts - prevOuts,
      rbi: play.result?.rbi ?? 0,
      // The ball put in play is the last event with hitData.
      trajectory: [...(play.playEvents ?? [])].reverse().find(e => e.hitData)?.hitData?.trajectory ?? null,
    })

    bases = next
    prevOuts = postOuts
  }
  return rows
}

export async function fetchGamePlays(gamePk: number, gameDate: string): Promise<PlayRow[]> {
  const data = await getJson<{ allPlays?: RawPlay[] }>(
    `${MLB_API}/game/${gamePk}/playByPlay?fields=${PBP_FIELDS}`,
  )
  const rows = parsePlays(gamePk, gameDate, data.allPlays ?? [])

  // A pitcher charged under rule 9.16(h) who never had a matchup of his own in
  // the game: get his throwing hand from his player record.
  const missing = [...new Set(rows.filter(r => r.pitcher_id && !r.pitch_hand).map(r => r.pitcher_id!))]
  if (missing.length) {
    const people = await getJson<{ people?: Array<{ id: number; pitchHand?: { code?: string } }> }>(
      `${MLB_API}/people?personIds=${missing.join(',')}&fields=people,id,pitchHand,code`,
    )
    const hand = new Map((people.people ?? []).map(p => [p.id, p.pitchHand?.code ?? null]))
    for (const r of rows) if (r.pitcher_id && !r.pitch_hand) r.pitch_hand = hand.get(r.pitcher_id) ?? null
  }
  return rows
}

// ── Calendario ────────────────────────────────────────────────────────────────

export interface ScheduleGame {
  game_pk: number
  season: number
  game_date: string
  game_type: string
  abstract_state: string
  status: string
  away_team_id: number
  home_team_id: number
  venue_id: number | null
  game_time: string | null       // scheduled first pitch (UTC ISO)
  away_score: number | null
  home_score: number | null
  winner_team_id: number | null  // only once the game is final
}

interface RawSchedule {
  dates?: Array<{
    games?: Array<{
      gamePk: number
      gameType: string
      gameDate?: string
      officialDate: string
      season?: string
      status?: { abstractGameState?: string; detailedState?: string }
      teams?: {
        away?: { team?: { id?: number }; score?: number; isWinner?: boolean }
        home?: { team?: { id?: number }; score?: number; isWinner?: boolean }
      }
      venue?: { id?: number }
    }>
  }>
}

const DEAD_STATUSES = new Set(['Postponed', 'Cancelled'])

/**
 * Juegos de temporada regular y postemporada en el rango, uno por gamePk.
 * Un juego pospuesto aparece dos veces con el mismo gamePk (fecha original
 * "Postponed" y fecha de reposición); nos quedamos con la entrada viva.
 */
export async function fetchSchedule(startDate: string, endDate: string): Promise<ScheduleGame[]> {
  const fields = 'dates,games,gamePk,gameType,gameDate,officialDate,season,status,abstractGameState,detailedState,teams,away,home,team,id,score,isWinner,venue'
  const data = await getJson<RawSchedule>(
    `${MLB_API}/schedule?sportId=1&gameType=R,F,D,L,W&startDate=${startDate}&endDate=${endDate}&fields=${fields}`,
  )

  const byPk = new Map<number, ScheduleGame>()
  for (const d of data.dates ?? []) {
    for (const g of d.games ?? []) {
      const row: ScheduleGame = {
        game_pk: g.gamePk,
        season: Number(g.season ?? g.officialDate.slice(0, 4)),
        game_date: g.officialDate,
        game_type: g.gameType,
        abstract_state: g.status?.abstractGameState ?? 'Preview',
        status: g.status?.detailedState ?? 'Scheduled',
        away_team_id: g.teams?.away?.team?.id ?? 0,
        home_team_id: g.teams?.home?.team?.id ?? 0,
        venue_id: g.venue?.id ?? null,
        game_time: g.gameDate ?? null,
        away_score: g.teams?.away?.score ?? null,
        home_score: g.teams?.home?.score ?? null,
        winner_team_id: g.status?.abstractGameState !== 'Final' ? null
          : g.teams?.away?.isWinner ? g.teams.away.team?.id ?? null
          : g.teams?.home?.isWinner ? g.teams.home.team?.id ?? null
          : null,
      }
      const prev = byPk.get(row.game_pk)
      if (!prev || DEAD_STATUSES.has(prev.status) || !DEAD_STATUSES.has(row.status)) {
        byPk.set(row.game_pk, row)
      }
    }
  }
  return [...byPk.values()]
}

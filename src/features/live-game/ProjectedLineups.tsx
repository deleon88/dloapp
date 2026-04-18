import type { GumboLiveData } from '@/api/gumbo/types'
import styles from './ProjectedLineups.module.css'

interface Props {
  liveData: GumboLiveData
  awayTeamName: string
  homeTeamName: string
}

export default function ProjectedLineups({ liveData, awayTeamName, homeTeamName }: Props) {
  const away = liveData.boxscore.teams.away
  const home = liveData.boxscore.teams.home

  const awayLineup = buildLineup(away.battingOrder, away.players)
  const homeLineup = buildLineup(home.battingOrder, home.players)

  const awayConfirmed = awayLineup.length > 0
  const homeConfirmed = homeLineup.length > 0

  return (
    <div className={styles.card}>
      <div className={styles.sectionTitle}>Lineups proyectados</div>

      <div className={styles.columns}>
        {/* Away */}
        <div className={styles.column}>
          <div className={styles.teamHeader}>
            <span className={styles.teamName}>{awayTeamName}</span>
            <span className={[styles.badge, awayConfirmed ? styles.confirmed : styles.projected].join(' ')}>
              {awayConfirmed ? 'Confirmed' : 'Projected'}
            </span>
          </div>
          {awayConfirmed ? (
            <>
              <LineupHeader />
              {awayLineup.map((p, i) => <LineupRow key={p.id} order={i + 1} player={p} />)}
            </>
          ) : (
            <p className={styles.empty}>Lineup not yet available</p>
          )}
        </div>

        <div className={styles.divider} />

        {/* Home */}
        <div className={styles.column}>
          <div className={styles.teamHeader}>
            <span className={styles.teamName}>{homeTeamName}</span>
            <span className={[styles.badge, homeConfirmed ? styles.confirmed : styles.projected].join(' ')}>
              {homeConfirmed ? 'Confirmed' : 'Projected'}
            </span>
          </div>
          {homeConfirmed ? (
            <>
              <LineupHeader />
              {homeLineup.map((p, i) => <LineupRow key={p.id} order={i + 1} player={p} />)}
            </>
          ) : (
            <p className={styles.empty}>Lineup not yet available</p>
          )}
        </div>
      </div>
    </div>
  )
}

function LineupHeader() {
  return (
    <div className={styles.lineupHeader}>
      <span>#</span>
      <span>Batter</span>
      <span>POS</span>
      <span>AVG</span>
      <span>OBP</span>
      <span>OPS</span>
    </div>
  )
}

function LineupRow({ order, player }: { order: number; player: LineupPlayer }) {
  return (
    <div className={styles.lineupRow}>
      <span className={styles.order}>{order}</span>
      <span className={styles.name}>{fmtName(player.name)}</span>
      <span className={styles.pos}>{player.pos}</span>
      <span className={styles.stat}>{player.avg}</span>
      <span className={styles.stat}>{player.obp}</span>
      <span className={styles.statBold}>{player.ops}</span>
    </div>
  )
}

interface LineupPlayer {
  id: number
  name: string
  pos: string
  avg: string
  obp: string
  ops: string
}

function buildLineup(
  order: number[],
  players: Record<string, { person: { id: number; fullName: string; link: string }; position: { abbreviation: string }; seasonStats: { batting: Record<string, number | string> } }>,
): LineupPlayer[] {
  return order.map((id) => {
    const p = players[`ID${id}`]
    if (!p) return null
    const b = p.seasonStats?.batting ?? {}
    return {
      id,
      name: p.person.fullName,
      pos: p.position.abbreviation,
      avg: fmt3(b.avg),
      obp: fmt3(b.obp),
      ops: fmt3(b.ops),
    }
  }).filter((p): p is LineupPlayer => p !== null)
}

function fmt3(v: string | number | undefined): string {
  if (v === undefined || v === null) return '.---'
  const s = String(v)
  // Already formatted like ".280"
  if (s.startsWith('.')) return s
  return s
}

function fmtName(n: string): string {
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}` : n
}

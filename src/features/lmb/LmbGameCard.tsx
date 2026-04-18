import type React from 'react'
import { Link } from 'react-router-dom'
import { getLmbTeamMeta } from '@/data/lmbTeams'
import { teamBg } from '@/data/teams'
import type { LmbGame } from '@/api/lmb/types'
import styles from './LmbGameCard.module.css'

interface Props {
  game: LmbGame
  animDelay?: number
}

export default function LmbGameCard({ game, animDelay = 0 }: Props) {
  const { awayTeam, localTeam, status, hora, inning, outs } = game

  const awayMeta = getLmbTeamMeta(awayTeam.shortName)
  const homeMeta = getLmbTeamMeta(localTeam.shortName)
  const ac = awayMeta.color
  const hc = homeMeta.color

  const isFinal = status === 'F'
  const isUpcoming = status === 'P'
  const isLive = !isFinal && !isUpcoming

  const statusLabel = isFinal
    ? 'FINAL'
    : isLive
    ? `${inning.part === 'Baja' ? '▼' : '▲'}${inning.number}${outs > 0 ? ` · ${outs} out` : ''}`
    : hora

  return (
    <Link
      to={`/lmb/game/${game.gameId}`}
      className={`${styles.card} fade-up`}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className={styles.hoverBg} style={{ background: teamBg(ac, hc) }} />

      <div className={styles.header}>
        <span className={`${styles.time} ${isLive ? styles.timeLive : ''}`}>{statusLabel}</span>
        <span className={styles.venue}>{game.stadium ?? ''}</span>
      </div>

      <div className={styles.matchup}>
        <TeamSide
          team={awayTeam}
          color={ac}
          score={!isUpcoming ? awayTeam.runsScored : undefined}
        />
        <TeamSide
          team={localTeam}
          color={hc}
          score={!isUpcoming ? localTeam.runsScored : undefined}
        />
      </div>
    </Link>
  )
}

function TeamSide({
  team, color, score,
}: {
  team: LmbGame['awayTeam']
  color: string
  score?: number
}) {
  return (
    <div className={styles.teamSide}>
      <div
        className={styles.logoWrap}
        style={{ '--team-glow': color } as React.CSSProperties}
      >
        <img
          src={team.urlLogo}
          alt={team.shortName}
          loading="lazy"
          width={40}
          height={40}
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
        />
      </div>
      <div className={styles.teamCity}>{team.name}</div>
      <div className={styles.teamNickname}>{team.shortName.toUpperCase()}</div>
      <div className={styles.teamRecord}>{team.winGames}-{team.lostGames}</div>
      {team.probablePitcher && (
        <div className={styles.pitcher}>{fmtName(team.probablePitcher)}</div>
      )}
      {score !== undefined && (
        <div className={styles.score}>{score}</div>
      )}
    </div>
  )
}

function fmtName(n: string): string {
  if (!n) return 'TBD'
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : n
}

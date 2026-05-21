import type React from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { NrfiGameRanking, NrfiSignal } from '@/api/mlb/endpoints/nrfiRankings'
import type { ScheduledGame } from '@/api/mlb/types'
import { getTeamMeta, capLogoUrl, teamBg } from '@/data/teams'
import styles from './NrfiCard.module.css'

function scoreColor(score: number): string {
  if (score >= 65) return 'var(--accent-emerald)'
  if (score >= 55) return 'var(--accent-blue)'
  if (score >= 45) return 'var(--accent-amber)'
  return 'var(--accent-red)'
}

function fmtName(n: string): string {
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : n
}

function SignalIcon({ type }: { type: NrfiSignal['type'] }) {
  if (type === 'positive') return <span className={styles.signalPos}>✓</span>
  if (type === 'negative') return <span className={styles.signalNeg}>✗</span>
  return <span className={styles.signalNeutral}>·</span>
}

function ConfBadge({ conf }: { conf: NrfiGameRanking['confidence'] }) {
  const cls = conf === 'high' ? styles.confHigh : conf === 'medium' ? styles.confMed : styles.confLow
  return <span className={`${styles.conf} ${cls}`}>{conf}</span>
}

interface Props {
  ranking: NrfiGameRanking
  rank: number
  bet: 'nrfi' | 'yrfi'
  game?: ScheduledGame
}

export default function NrfiCard({ ranking: r, rank, bet, game }: Props) {
  const score    = bet === 'nrfi' ? r.nrfiScore : r.yrfiScore
  const barColor = scoreColor(score)
  const time     = format(parseISO(r.gameDate), 'h:mm a')

  const am = getTeamMeta(r.awayTeamId)
  const hm = getTeamMeta(r.homeTeamId)
  const ac = am?.color ?? '#555'
  const hc = hm?.color ?? '#555'

  const awayRecord = game?.teams.away.leagueRecord
  const homeRecord = game?.teams.home.leagueRecord
  const venueName  = game?.venue.name ?? r.parkName

  return (
    <Link to={`/game/${r.gamePk}`} className={`${styles.card} fade-up`}>
      <div className={styles.hoverBg} style={{ background: teamBg(ac, hc) }} />

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.rank}>#{rank}</span>
        <span className={styles.time}>{time}</span>
        <span className={styles.venue}>{venueName}</span>
      </div>

      {/* Matchup */}
      <div className={styles.matchup}>
        <div className={styles.teamSide}>
          <div className={styles.logoWrap} style={{ '--team-glow': ac } as React.CSSProperties}>
            <img src={capLogoUrl(r.awayTeamId)} alt={am?.brief ?? r.awayTeamName} loading="lazy" width={40} height={40} />
          </div>
          <div className={styles.teamCity}>{am?.name ?? r.awayTeamName}</div>
          <div className={styles.teamNickname}>{(am?.brief ?? r.awayTeamName).toUpperCase()}</div>
          {awayRecord && <div className={styles.teamRecord}>{awayRecord.wins}-{awayRecord.losses}</div>}
          {r.awayStarter && (
            <>
              <div className={styles.pitcher}>{fmtName(r.awayStarter.name)}</div>
              <div className={styles.pitcherHand}>{r.awayStarter.hand}HP</div>
            </>
          )}
        </div>

        <div className={styles.teamSide}>
          <div className={styles.logoWrap} style={{ '--team-glow': hc } as React.CSSProperties}>
            <img src={capLogoUrl(r.homeTeamId)} alt={hm?.brief ?? r.homeTeamName} loading="lazy" width={40} height={40} />
          </div>
          <div className={styles.teamCity}>{hm?.name ?? r.homeTeamName}</div>
          <div className={styles.teamNickname}>{(hm?.brief ?? r.homeTeamName).toUpperCase()}</div>
          {homeRecord && <div className={styles.teamRecord}>{homeRecord.wins}-{homeRecord.losses}</div>}
          {r.homeStarter && (
            <>
              <div className={styles.pitcher}>{fmtName(r.homeStarter.name)}</div>
              <div className={styles.pitcherHand}>{r.homeStarter.hand}HP</div>
            </>
          )}
        </div>
      </div>

      {/* NRFI/YRFI score bar */}
      <div className={styles.scoreRow}>
        <span className={styles.betLabel}>{bet.toUpperCase()}</span>
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${score}%`, background: barColor }} />
        </div>
        <span className={styles.scoreNum} style={{ color: barColor }}>{score}</span>
        <ConfBadge conf={r.confidence} />
      </div>

      {/* Signals */}
      {r.topSignals.length > 0 && (
        <div className={styles.signals}>
          {r.topSignals.slice(0, 3).map((sig, i) => (
            <div key={i} className={styles.signal}>
              <SignalIcon type={sig.type} />
              <span className={styles.sigLabel}>{sig.label}</span>
              <span className={styles.sigValue}>{sig.value}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

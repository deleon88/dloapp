import type { GameStatusDetail } from '@/api/mlb/types'
import styles from './GameStatusBadge.module.css'

interface Props {
  status: GameStatusDetail
}

export default function GameStatusBadge({ status }: Props) {
  const { abstractGameState, detailedState } = status

  const variant =
    abstractGameState === 'Live'
      ? 'live'
      : abstractGameState === 'Final'
        ? 'final'
        : detailedState === 'Postponed' || detailedState === 'Cancelled'
          ? 'postponed'
          : 'preview'

  const label =
    abstractGameState === 'Live'
      ? detailedState
      : abstractGameState === 'Final'
        ? 'Final'
        : detailedState

  return (
    <span className={[styles.badge, styles[variant]].join(' ')}>
      {variant === 'live' && <span className={styles.dot} />}
      {label}
    </span>
  )
}

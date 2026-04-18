import type { GumboFeed } from '@/api/gumbo/types'
import Linescore from './Linescore'
import PlayByPlay from './PlayByPlay'
import DiamondDisplay from './DiamondDisplay'
import styles from './LiveView.module.css'

interface Props {
  feed: GumboFeed
}

export default function LiveView({ feed }: Props) {
  const { gameData, liveData } = feed
  const { teams, status } = gameData
  const isLive = status.abstractGameState === 'Live'

  return (
    <div className={styles.root}>
      <div className={styles.scoreboard}>
        <div className={styles.teamHeader}>
          <span className={styles.teamName}>{teams.away.name}</span>
          <span className={styles.vs}>@</span>
          <span className={styles.teamName}>{teams.home.name}</span>
        </div>
        <Linescore linescore={liveData.linescore} teams={teams} />
      </div>

      {isLive && (
        <div className={styles.diamond}>
          <DiamondDisplay linescore={liveData.linescore} />
        </div>
      )}

      <PlayByPlay plays={liveData.plays} />
    </div>
  )
}

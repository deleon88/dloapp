import type { GumboPlays } from '@/api/gumbo/types'
import styles from './PlayByPlay.module.css'

interface Props {
  plays: GumboPlays
}

export default function PlayByPlay({ plays }: Props) {
  const { allPlays } = plays
  const completedPlays = [...allPlays].reverse().filter((p) => p.about.isComplete)

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Play by Play</h2>
      <ol className={styles.list}>
        {completedPlays.map((play) => (
          <li
            key={play.atBatIndex}
            className={[styles.play, play.about.isScoringPlay ? styles.scoring : ''].join(' ')}
          >
            <span className={styles.inning}>
              {play.about.isTopInning ? '▲' : '▼'}{play.about.inning}
            </span>
            <span className={styles.description}>{play.result.description}</span>
            {play.about.isScoringPlay && (
              <span className={styles.score}>
                {play.result.awayScore}–{play.result.homeScore}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

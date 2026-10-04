import { BarFill, CountUp } from '@/components/AnimatedBar/AnimatedBar'
import styles from './MatchupBar.module.css'

interface Props {
  label: string
  aDisplay: string
  hDisplay: string
  /** Away bar fill width, 0–100. Value 50 = league average. */
  aw: number
  /** Home bar fill width, 0–100. Value 50 = league average. */
  hw: number
  ac: string
  hc: string
  /** Cascade stagger for this row, in ms. */
  delay?: number
}

export default function MatchupBar({ label, aDisplay, hDisplay, aw, hw, ac, hc, delay = 0 }: Props) {
  return (
    <div className={styles.row}>
      <div className={styles.sideAway}>
        <span className={styles.val}><CountUp value={aDisplay} delay={delay} /></span>
        <div className={styles.trackHalf}>
          <BarFill className={styles.fillAway} width={aw} color={ac} delay={delay} />
          <div className={styles.avgLine} />
        </div>
      </div>
      <span className={styles.label}>{label}</span>
      <div className={styles.sideHome}>
        <div className={styles.trackHalf}>
          <BarFill className={styles.fillHome} width={hw} color={hc} delay={delay} />
          <div className={styles.avgLine} />
        </div>
        <span className={styles.val}><CountUp value={hDisplay} delay={delay} /></span>
      </div>
    </div>
  )
}

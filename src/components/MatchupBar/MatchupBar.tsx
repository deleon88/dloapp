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
}

export default function MatchupBar({ label, aDisplay, hDisplay, aw, hw, ac, hc }: Props) {
  return (
    <div className={styles.row}>
      <div className={styles.sideAway}>
        <span className={styles.val}>{aDisplay}</span>
        <div className={styles.trackHalf}>
          <div className={styles.fillAway} style={{ width: `${aw}%`, background: ac }} />
          <div className={styles.avgLine} />
        </div>
      </div>
      <span className={styles.label}>{label}</span>
      <div className={styles.sideHome}>
        <div className={styles.trackHalf}>
          <div className={styles.fillHome} style={{ width: `${hw}%`, background: hc }} />
          <div className={styles.avgLine} />
        </div>
        <span className={styles.val}>{hDisplay}</span>
      </div>
    </div>
  )
}

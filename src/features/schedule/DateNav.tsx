import { format, parseISO } from 'date-fns'
import styles from './DateNav.module.css'

interface Props {
  date: string
  onPrev: () => void
  onNext: () => void
}

export default function DateNav({ date, onPrev, onNext }: Props) {
  const parsed = parseISO(date)
  const isToday = date === format(new Date(), 'yyyy-MM-dd')
  const label = format(parsed, 'EEE, MMM d')

  return (
    <div className={styles.nav}>
      <button className={styles.arrow} onClick={onPrev} aria-label="Previous day">
        ‹
      </button>
      <div className={styles.center}>
        <span className={styles.label}>{label}</span>
        {isToday && <span className={styles.todayBadge}>today</span>}
      </div>
      <button className={styles.arrow} onClick={onNext} aria-label="Next day">
        ›
      </button>
    </div>
  )
}

import { format, parseISO } from 'date-fns'
import { etDate } from '@/utils/etDate'
import styles from './DateNav.module.css'

interface Props {
  date: string
  onPrev: () => void
  onNext: () => void
  /** The page's "today" (YYYY-MM-DD). MLB pages use ET, the default. */
  today?: string
}

export default function DateNav({ date, onPrev, onNext, today = etDate() }: Props) {
  const parsed = parseISO(date)
  const isToday = date === today
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

import type { GumboLinescore } from '@/api/gumbo/types'
import styles from './DiamondDisplay.module.css'

interface Props {
  linescore: GumboLinescore
}

export default function DiamondDisplay({ linescore }: Props) {
  const { offense, balls = 0, strikes = 0, outs = 0 } = linescore
  const onFirst = !!offense.first
  const onSecond = !!offense.second
  const onThird = !!offense.third

  return (
    <div className={styles.container}>
      <div className={styles.diamond}>
        <Base occupied={onSecond} position="second" />
        <Base occupied={onThird} position="third" />
        <Base occupied={onFirst} position="first" />
        <div className={styles.homePlate} />
      </div>

      <div className={styles.counts}>
        <CountRow label="B" total={4} filled={balls} colorClass={styles.ball} />
        <CountRow label="S" total={3} filled={strikes} colorClass={styles.strike} />
        <CountRow label="O" total={3} filled={outs} colorClass={styles.out} />
      </div>
    </div>
  )
}

function Base({ occupied, position }: { occupied: boolean; position: string }) {
  return (
    <div
      className={[styles.base, styles[position], occupied ? styles.occupied : styles.empty].join(' ')}
    />
  )
}

function CountRow({
  label,
  total,
  filled,
  colorClass,
}: {
  label: string
  total: number
  filled: number
  colorClass: string
}) {
  return (
    <div className={styles.countRow}>
      <span className={styles.countLabel}>{label}</span>
      <div className={styles.dots}>
        {Array.from({ length: total - 1 }).map((_, i) => (
          <span
            key={i}
            className={[styles.dot, i < filled ? colorClass : styles.dotEmpty].join(' ')}
          />
        ))}
      </div>
    </div>
  )
}

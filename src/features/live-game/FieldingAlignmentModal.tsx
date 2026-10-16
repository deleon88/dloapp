import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import { useT } from '@/i18n/useT'
import CardModal from './CardModal'
import { cutoutUrl } from './mlbImages'
import styles from './FieldingAlignmentModal.module.css'

// Where each position stands, in % of the field box (the SVG below is drawn on
// a 300 × 340 viewBox stretched to the same box, so lines and players line up).
// The DH has no spot on the field: bottom-right corner, same as everyone else.
const SPOTS: Record<string, { x: number; y: number }> = {
  CF:   { x: 50, y: 12 },
  LF:   { x: 18, y: 26 },
  RF:   { x: 82, y: 26 },
  SS:   { x: 33, y: 43 },
  '2B': { x: 67, y: 43 },
  '3B': { x: 21, y: 59 },
  '1B': { x: 79, y: 59 },
  C:    { x: 50, y: 87 },
  DH:   { x: 86, y: 88 },
}

function lastName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : parts.slice(1).join(' ')
}

interface Props {
  isOpen: boolean
  onClose: () => void
  lineup: LineupSlot[]
  color: string        // team bar color: tints the chalk lines
  bgColor: string      // raw team color for the background
  side: 'away' | 'home'
  label: string
}

/**
 * Defensive alignment, TV style: each starter's cutout at their position on a
 * chalk-line field (dashed, no fill) and the DH in the bottom-right corner.
 */
export default function FieldingAlignmentModal({ isOpen, onClose, lineup, color, bgColor, side, label }: Props) {
  const t = useT()
  const players: Array<{ id: number; fullName: string; pos: string }> = []
  const taken = new Set<string>()
  for (const slot of lineup) {
    if (!SPOTS[slot.pos] || taken.has(slot.pos)) continue
    taken.add(slot.pos)
    players.push({ id: slot.id, fullName: slot.fullName, pos: slot.pos })
  }

  // Chalk: the team's bar color lightened, so it reads on any team background.
  const chalk = `color-mix(in srgb, ${color} 45%, white)`

  return (
    <CardModal isOpen={isOpen} onClose={onClose} title={label} subtitle={t('fieldingWord')} awayColor={bgColor} homeColor={bgColor} mode={side}>
      <div className={styles.field}>
        <svg className={styles.lines} viewBox="0 0 300 340" preserveAspectRatio="none" aria-hidden="true"
          style={{ ['--chalk' as string]: chalk }}>
          {/* Foul lines and the outfield wall (behind the outfielders) */}
          <path d="M150 300 L -30 120 M150 300 L 330 120" className={styles.chalkSoft} />
          <path d="M-30 120 Q 150 -110 330 120" className={styles.chalk} />
          {/* Infield: diamond and mound */}
          <path d="M150 300 L 236 213 L 150 128 L 64 213 Z" className={styles.chalk} />
          <circle cx="150" cy="214" r="12" className={styles.chalkSoft} />
          {/* Bases */}
          <g className={styles.bases}>
            <rect x="232" y="209" width="8" height="8" transform="rotate(45 236 213)" />
            <rect x="146" y="124" width="8" height="8" transform="rotate(45 150 128)" />
            <rect x="60" y="209" width="8" height="8" transform="rotate(45 64 213)" />
            <path d="M144 296 h12 v4 l-6 5 l-6 -5 z" />
          </g>
        </svg>

        {players.map(p => (
          <div key={p.pos} className={styles.player} style={{ left: `${SPOTS[p.pos].x}%`, top: `${SPOTS[p.pos].y}%` }}>
            <img className={styles.photo} src={cutoutUrl(p.id, 120)} alt="" loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
            <span className={styles.last} title={p.fullName}>{lastName(p.fullName)}</span>
            <span className={styles.pos}>{p.pos}</span>
          </div>
        ))}
      </div>
    </CardModal>
  )
}

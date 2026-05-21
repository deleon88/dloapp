import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import CardModal from './CardModal'
import styles from './FieldingAlignmentModal.module.css'

// Player positions in SVG coordinate space (viewBox 0 0 300 340)
// SS/2B are just outside the infield diamond:
//   2B along the 45° diagonal toward RF (extension of the 1B→2B baseline)
//   SS along the 135° diagonal toward LF (extension of the 3B→2B baseline)
const SVG_POSITIONS: Record<string, { x: number; y: number }> = {
  CF:   { x: 150, y: 36  },
  LF:   { x: 54,  y: 84  },
  RF:   { x: 246, y: 84  },
  SS:   { x: 100, y: 140 },
  '2B': { x: 200, y: 140 },
  '3B': { x: 63,  y: 196 },
  '1B': { x: 237, y: 196 },
  P:    { x: 150, y: 208 },
  C:    { x: 150, y: 298 },
}

function lastName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : parts.slice(1).join(' ')
}

function truncate(name: string, max = 11): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

interface Props {
  isOpen: boolean
  onClose: () => void
  lineup: LineupSlot[]
  color: string        // bar color for player dots
  bgColor: string      // raw team color for background gradient
  side: 'away' | 'home'
  label: string
}

export default function FieldingAlignmentModal({ isOpen, onClose, lineup, color, bgColor, side, label }: Props) {
  const positioned = lineup.reduce<Record<string, LineupSlot>>((acc, slot) => {
    if (SVG_POSITIONS[slot.pos]) acc[slot.pos] = slot
    return acc
  }, {})

  return (
    <CardModal isOpen={isOpen} onClose={onClose} title={label} subtitle="Fielding" awayColor={bgColor} homeColor={bgColor} mode={side}>
      <div className={styles.diamond}>
        <svg
          viewBox="0 0 300 340"
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
          aria-label="Alineación defensiva"
        >
          <defs>
            <filter id="fa-glow" x="-120%" y="-120%" width="340%" height="340%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Foul line extensions */}
          <line x1="233" y1="191" x2="275" y2="148" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
          <line x1="67"  y1="191" x2="25"  y2="148" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />

          {/* Outfield semicircle */}
          <path
            d="M 25,148 A 125,125 0 0,1 275,148"
            fill="none"
            stroke="rgba(255,255,255,0.09)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          {/* Infield diamond */}
          <polygon
            points="150,276 233,191 150,106 67,191"
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Pitcher's mound */}
          <circle cx="150" cy="195" r="7" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />

          {/* Base markers */}
          <circle cx="150" cy="276" r="3.5" fill="rgba(255,255,255,0.28)" />
          <circle cx="233" cy="191" r="3"   fill="rgba(255,255,255,0.28)" />
          <circle cx="150" cy="106" r="3"   fill="rgba(255,255,255,0.28)" />
          <circle cx="67"  cy="191" r="3"   fill="rgba(255,255,255,0.28)" />

          {/* Player nodes */}
          {Object.entries(SVG_POSITIONS).map(([pos, { x, y }]) => {
            const player = positioned[pos]
            if (!player) return null
            const name = truncate(lastName(player.fullName))
            return (
              <g key={pos}>
                <circle cx={x} cy={y} r="5" fill={color} filter="url(#fa-glow)" />
                <text
                  x={x} y={y + 14}
                  textAnchor="middle"
                  fontFamily="DM Sans, system-ui, sans-serif"
                  fontSize="9.5"
                  fontWeight="600"
                  letterSpacing="0.2"
                  fill="rgba(255,255,255,0.88)"
                >
                  {name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </CardModal>
  )
}

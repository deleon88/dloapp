import { useState } from 'react'
import type { PitcherInfo, PitcherSeasonStats } from '@/api/mlb/endpoints/pitcherStats'
import { fipPlus } from '@/api/mlb/endpoints/pitcherStats'
import type { ViewMode } from './LineupComparison'
import CardBgLayers from './CardBgLayers'
import MatchupBar from '@/components/MatchupBar/MatchupBar'
import styles from './PitcherMatchup.module.css'

interface Props {
  awayPitcher?: PitcherInfo
  homePitcher?: PitcherInfo
  awayColor: string
  homeColor: string
  awayBarColor?: string
  homeBarColor?: string
  awayPitcherName?: string
  homePitcherName?: string
  mode: ViewMode
}

const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:best/v1/people/${id}/headshot/67/current`

export default function PitcherMatchup({ awayPitcher, homePitcher, awayColor, homeColor, awayBarColor, homeBarColor, awayPitcherName, homePitcherName, mode }: Props) {
  const [view, setView] = useState(0)
  const ac = awayBarColor ?? awayColor
  const hc = homeBarColor ?? homeColor
  const as = awayPitcher?.seasonStats
  const hs = homePitcher?.seasonStats

  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

      {/* ── Pitcher headers ────────────────────────────────────────── */}
      <div className={styles.pitcherRow}>
        {/* Away */}
        <div className={styles.pitcherSide}>
          {awayPitcher && (
            <img
              src={HEADSHOT(awayPitcher.id)}
              alt={awayPitcher.fullName}
              className={styles.headshot}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div className={styles.pitcherInfo}>
            <div className={styles.pitcherMeta}>
              {awayPitcher?.primaryNumber && <span>#{awayPitcher.primaryNumber}</span>}
              {awayPitcher?.pitchHand && <span>· {awayPitcher.pitchHand}</span>}
            </div>
            <div className={styles.pitcherName}>{awayPitcher?.fullName ?? awayPitcherName ?? 'TBD'}</div>
            {as && (
              <div className={styles.pitcherRecord}>
                {as.wins}-{as.losses} · {as.inningsPitched} IP · {as.qualityStarts} QS
              </div>
            )}
          </div>
        </div>

        {/* Home */}
        <div className={`${styles.pitcherSide} ${styles.pitcherSideRight}`}>
          <div className={styles.pitcherInfo} style={{ textAlign: 'right' }}>
            <div className={styles.pitcherMeta} style={{ justifyContent: 'flex-end' }}>
              {homePitcher?.pitchHand && <span>{homePitcher.pitchHand} ·</span>}
              {homePitcher?.primaryNumber && <span>#{homePitcher.primaryNumber}</span>}
            </div>
            <div className={styles.pitcherName}>{homePitcher?.fullName ?? homePitcherName ?? 'TBD'}</div>
            {hs && (
              <div className={styles.pitcherRecord}>
                {hs.wins}-{hs.losses} · {hs.inningsPitched} IP · {hs.qualityStarts} QS
              </div>
            )}
          </div>
          {homePitcher && (
            <img
              src={HEADSHOT(homePitcher.id)}
              alt={homePitcher.fullName}
              className={styles.headshot}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>
      </div>

      {/* ── Stat views (click left = prev, click right = next) ───── */}
      <div className={styles.barsSection} onClick={(e) => {
        const left = e.currentTarget.getBoundingClientRect().left
        const mid  = e.currentTarget.offsetWidth / 2
        setView(v => e.clientX - left < mid ? (v + 2) % 3 : (v + 1) % 3)
      }}>

        {view === 0 && (
          <div className={styles.bars}>
            <PitchBar
              label="FIP"
              aVal={as?.fip ? as.fip.toFixed(2) : undefined}
              hVal={hs?.fip ? hs.fip.toFixed(2) : undefined}
              aw={as?.fipMinus ? fipPlusBarWidth(fipPlus(as.fipMinus)) : 0}
              hw={hs?.fipMinus ? fipPlusBarWidth(fipPlus(hs.fipMinus)) : 0}
              ac={ac}
              hc={hc}
            />
            <PitchBar
              label="ERA"
              aVal={as?.era}
              hVal={hs?.era}
              lowerIsBetter
              ac={ac}
              hc={hc}
            />
            <PitchBar
              label="WHIP"
              aVal={as?.whip}
              hVal={hs?.whip}
              lowerIsBetter
              ac={ac}
              hc={hc}
            />
          </div>
        )}

        {view === 1 && (
          <PitcherChips
            away={[
              { label: 'K-BB%', val: kbbPct(as) },
              { label: 'R/9',   val: as?.runsScoredPer9        ?? '—' },
              { label: 'IP/G',  val: as?.inningsPitchedPerGame ?? '—' },
            ]}
            home={[
              { label: 'K-BB%', val: kbbPct(hs) },
              { label: 'R/9',   val: hs?.runsScoredPer9        ?? '—' },
              { label: 'IP/G',  val: hs?.inningsPitchedPerGame ?? '—' },
            ]}
          />
        )}

        {view === 2 && (
          <PitcherChips
            away={[
              { label: 'xFIP',  val: as?.xfip   ? as.xfip.toFixed(2)  : '—' },
              { label: 'wOBA',  val: as?.woba   ?? '—' },
              { label: 'xwOBA', val: as?.wobaCon ?? '—' },
            ]}
            home={[
              { label: 'xFIP',  val: hs?.xfip   ? hs.xfip.toFixed(2)  : '—' },
              { label: 'wOBA',  val: hs?.woba   ?? '—' },
              { label: 'xwOBA', val: hs?.wobaCon ?? '—' },
            ]}
          />
        )}

        <div className={styles.viewDots}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`${styles.viewDot} ${view === i ? styles.viewDotActive : ''}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Chip view ───────────────────────────────────────────────────── */

function PitcherChips({
  away, home,
}: {
  away: { label: string; val: string }[]
  home: { label: string; val: string }[]
}) {
  return (
    <div className={styles.chipView}>
      <div className={styles.chipGroup}>
        {away.map(c => (
          <div key={c.label} className={styles.chip}>
            <span className={styles.chipLabel}>{c.label}</span>
            <span className={styles.chipVal}>{c.val}</span>
          </div>
        ))}
      </div>
      <div className={`${styles.chipGroup} ${styles.chipGroupRight}`}>
        {home.map(c => (
          <div key={c.label} className={styles.chip}>
            <span className={styles.chipLabel}>{c.label}</span>
            <span className={styles.chipVal}>{c.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Bar helpers ─────────────────────────────────────────────────── */

function PitchBar({ label, aVal, hVal, lowerIsBetter = false, ac, hc, aw, hw }: {
  label: string; aVal?: string; hVal?: string; lowerIsBetter?: boolean
  ac: string; hc: string; aw?: number; hw?: number
}) {
  const aN = aVal ? parseFloat(aVal) : null
  const hN = hVal ? parseFloat(hVal) : null
  return (
    <MatchupBar
      label={label}
      aDisplay={aVal ?? '—'}
      hDisplay={hVal ?? '—'}
      aw={aw ?? (aN !== null ? pitchBarWidth(label, aN, lowerIsBetter) : 0)}
      hw={hw ?? (hN !== null ? pitchBarWidth(label, hN, lowerIsBetter) : 0)}
      ac={ac}
      hc={hc}
    />
  )
}

/** K-BB% = (K - BB) / TBF × 100 */
function kbbPct(s: PitcherSeasonStats | undefined): string {
  if (!s || !s.battersFaced) return '—'
  return ((s.strikeOuts - s.baseOnBalls) / s.battersFaced * 100).toFixed(1) + '%'
}

/** FIP+ scale 70–130; value 100 (avg) → 50%. */
function fipPlusBarWidth(v: number): number {
  return Math.round(((Math.max(70, Math.min(130, v)) - 70) / 60) * 100)
}

/** Returns 0–100. Value at the league-average midpoint → 50%. */
function pitchBarWidth(label: string, v: number, lowerIsBetter: boolean): number {
  let norm: number
  if (label === 'ERA') {
    // range [1.5, 6.0], avg 3.75 → 50%
    norm = lowerIsBetter
      ? (6.0 - Math.max(1.5, Math.min(6.0, v))) / 4.5
      : (Math.max(1.5, Math.min(6.0, v)) - 1.5) / 4.5
  } else {
    // WHIP: range [0.7, 1.9], avg 1.3 → 50%
    norm = lowerIsBetter
      ? (1.9 - Math.max(0.7, Math.min(1.9, v))) / 1.2
      : (Math.max(0.7, Math.min(1.9, v)) - 0.7) / 1.2
  }
  return Math.round(norm * 100)
}

import { useState } from 'react'
import type { PitcherInfo, PitcherSeasonStats } from '@/api/mlb/endpoints/pitcherStats'
import type { ViewMode } from './LineupComparison'
import { useT } from '@/i18n/useT'
import type { TKey } from '@/i18n/useT'
import CardBgLayers from './CardBgLayers'
import CardModal from './CardModal'
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
  /** When true, the xwOBA chip shows wOBA-against instead — no Statcast batter-stand
   * filter exists (see savantStats.ts), so xwOBA can't be hand-split; wOBA-against
   * (from the same hand-split source as FIP/ERA/WHIP above) is the honest substitute.
   * Independently of this flag, each side also falls back to wOBA-against whenever
   * its own xwobaComputed is null (e.g. rolling windows, where Savant's pitcher
   * query is currently broken and expectedStatistics can't be trusted for date
   * ranges) — see the per-side xwOBA fallback logic below. */
  isPitcherHandFiltered?: boolean
}

const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:best/v1/people/${id}/headshot/67/current`

export default function PitcherMatchup({ awayPitcher, homePitcher, awayColor, homeColor, awayBarColor, homeBarColor, awayPitcherName, homePitcherName, mode, isPitcherHandFiltered }: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const t = useT()
  const ac = awayBarColor ?? awayColor
  const hc = homeBarColor ?? homeColor
  const as = awayPitcher?.seasonStats
  const hs = homePitcher?.seasonStats

  // computed values work for both date ranges and full season; fall back to sabermetrics when absent
  const aFipDisplay  = as ? (as.fipComputed  ?? (as.fip  || null)) : null
  const hFipDisplay  = hs ? (hs.fipComputed  ?? (hs.fip  || null)) : null
  const aXfipDisplay = as ? (as.xfipComputed ?? (as.xfip || null)) : null
  const hXfipDisplay = hs ? (hs.xfipComputed ?? (hs.xfip || null)) : null

  // Show wOBA-against in place of xwOBA whenever xwOBA itself isn't available for
  // that side — not just when the pitcher hand filter forces it. Each side is
  // independent (one pitcher can have real xwOBA while the other doesn't).
  const awayShowWoba = isPitcherHandFiltered || as?.xwobaComputed == null
  const homeShowWoba = isPitcherHandFiltered || hs?.xwobaComputed == null

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

        <button className={styles.glossaryBtn} onClick={() => setGlossaryOpen(true)}>?</button>

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

      {/* ── Bars ──────────────────────────────────────────────────── */}
      <div className={styles.bars}>
        <PitchBar
          label="FIP"
          aVal={aFipDisplay != null ? aFipDisplay.toFixed(2) : undefined}
          hVal={hFipDisplay != null ? hFipDisplay.toFixed(2) : undefined}
          aw={as?.fipPlusComputed != null ? fipPlusBarWidth(as.fipPlusComputed) : 0}
          hw={hs?.fipPlusComputed != null ? fipPlusBarWidth(hs.fipPlusComputed) : 0}
          ac={ac}
          hc={hc}
        />
        <PitchBar label="ERA"  aVal={as?.era}  hVal={hs?.era}  lowerIsBetter ac={ac} hc={hc} />
        <PitchBar label="WHIP" aVal={as?.whip} hVal={hs?.whip} lowerIsBetter ac={ac} hc={hc} />
      </div>

      {/* ── Stat glossary overlay ─────────────────────────────────── */}
      <CardModal
        isOpen={glossaryOpen} onClose={() => setGlossaryOpen(false)}
        title={t('statGlossary')}
        awayColor={awayColor} homeColor={homeColor} mode="comparison"
      >
        <div className={styles.glossaryList}>
          {(isPitcherHandFiltered
            ? [...GLOSSARY.filter(g => g.stat !== 'xwOBA'), GLOSSARY_WOBA_AGAINST]
            : (awayShowWoba || homeShowWoba)
              ? [...GLOSSARY, GLOSSARY_WOBA_AGAINST]
              : GLOSSARY
          ).map(({ stat, descKey }) => (
            <div key={stat} className={styles.glossaryItem}>
              <span className={styles.glossaryStat}>{stat}</span>
              <span className={styles.glossaryDesc}>{t(descKey)}</span>
            </div>
          ))}
        </div>
      </CardModal>

      {/* ── Always-visible chips ───────────────────────────────────── */}
      <PitcherChips
        away={[
          { label: 'K-BB%', val: kbbPct(as) },
          { label: 'xFIP',  val: aXfipDisplay != null ? aXfipDisplay.toFixed(2) : '—' },
          awayShowWoba
            ? { label: 'wOBA', val: fmtWobaAgainst(as) }
            : { label: 'xwOBA', val: fmtXwoba(as) },
        ]}
        home={[
          { label: 'K-BB%', val: kbbPct(hs) },
          { label: 'xFIP',  val: hXfipDisplay != null ? hXfipDisplay.toFixed(2) : '—' },
          homeShowWoba
            ? { label: 'wOBA', val: fmtWobaAgainst(hs) }
            : { label: 'xwOBA', val: fmtXwoba(hs) },
        ]}
      />
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

/* ── Glossary data ───────────────────────────────────────────────── */

const GLOSSARY: Array<{ stat: string; descKey: TKey }> = [
  { stat: 'ERA',   descKey: 'glossaryEraDesc' },
  { stat: 'FIP',   descKey: 'glossaryFipDesc' },
  { stat: 'WHIP',  descKey: 'glossaryWhipDesc' },
  { stat: 'K-BB%', descKey: 'glossaryKbbDesc' },
  { stat: 'xFIP',  descKey: 'glossaryXfipDesc' },
  { stat: 'xwOBA', descKey: 'glossaryXwobaDesc' },
]

const GLOSSARY_WOBA_AGAINST = { stat: 'wOBA', descKey: 'glossaryWobaAgainstDesc' as TKey }

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

/** xwOBA display: Savant computed value when available, MLB API expectedStatistics fallback */
function fmtXwoba(s: PitcherSeasonStats | undefined): string {
  if (!s) return '—'
  if (s.xwobaComputed != null) return s.xwobaComputed.toFixed(3).replace(/^0/, '')
  return s.woba !== '-.---' ? s.woba : '—'
}

/** wOBA-against, shown in place of xwOBA when a pitcher hand filter is active
 * (no Statcast batter-stand filter exists — see savantStats.ts). Never falls back
 * to the season-wide xwOBA/wOBA, which would silently mislabel a different number. */
function fmtWobaAgainst(s: PitcherSeasonStats | undefined): string {
  if (!s || s.wobaAgainstComputed == null) return '—'
  return s.wobaAgainstComputed.toFixed(3).replace(/^0/, '')
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

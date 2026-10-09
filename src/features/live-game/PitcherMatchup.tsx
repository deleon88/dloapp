import { useState } from 'react'
import type { PitcherInfo, PitcherSeasonStats } from '@/api/mlb/endpoints/pitcherStats'
import { fipPlus } from '@/api/mlb/endpoints/pitcherStats'
import type { ViewMode } from './LineupComparison'
import { useT } from '@/i18n/useT'
import type { TKey } from '@/i18n/useT'
import CardBgLayers from './CardBgLayers'
import CardModal from './CardModal'
import MatchupBar from '@/components/MatchupBar/MatchupBar'
import styles from './PitcherMatchup.module.css'
import type { BulkArm } from '@/api/pitcherRoles'
import { BULLPEN_CARD_ID } from './BullpenCard'

interface Props {
  awayPitcher?: PitcherInfo
  homePitcher?: PitcherInfo
  awayColor: string
  homeColor: string
  awayBarColor?: string
  homeBarColor?: string
  awayPitcherName?: string
  homePitcherName?: string
  /** Probable starter is an opener (an inning or two, then the bullpen). */
  awayOpener?: boolean
  homeOpener?: boolean
  /** Probable bulk arm behind each opener, when the prediction is confident. */
  awayBulk?: BulkArm
  homeBulk?: BulkArm
  /** The bulk arms' numbers (same period / hand filters as the starters). */
  awayBulkInfo?: PitcherInfo
  homeBulkInfo?: PitcherInfo
  mode: ViewMode
  /** Shared card view: "Bullpen" on an opener's side switches it to that team. */
  onModeChange?: (m: ViewMode) => void
}

const HEADSHOT = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:best/v1/people/${id}/headshot/67/current`

export default function PitcherMatchup({ awayPitcher, homePitcher, awayColor, homeColor, awayBarColor, homeBarColor, awayPitcherName, homePitcherName, awayOpener, homeOpener, awayBulk, homeBulk, awayBulkInfo, homeBulkInfo, mode, onModeChange }: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  // Behind an opener, the card can show either arm; the opener (the listed starter) by default.
  const [awayRole, setAwayRole] = useState<SideRole>('opener')
  const [homeRole, setHomeRole] = useState<SideRole>('opener')
  const t = useT()
  const ac = awayBarColor ?? awayColor
  const hc = homeBarColor ?? homeColor

  const away = sideView(awayPitcher, awayPitcherName, awayOpener, awayBulk, awayBulkInfo, awayRole)
  const home = sideView(homePitcher, homePitcherName, homeOpener, homeBulk, homeBulkInfo, homeRole)
  const as = away.info?.seasonStats
  const hs = home.info?.seasonStats

  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

      {/* ── Pitcher headers ────────────────────────────────────────── */}
      <div className={styles.pitcherRow}>
        <PitcherHeader side="away" view={away} onRole={setAwayRole} onBullpen={() => goToBullpen('away', onModeChange)} />
        <button className={styles.glossaryBtn} onClick={() => setGlossaryOpen(true)}>?</button>
        <PitcherHeader side="home" view={home} onRole={setHomeRole} onBullpen={() => goToBullpen('home', onModeChange)} />
      </div>

      {/* ── Bars ──────────────────────────────────────────────────── */}
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
        {/* ERA doesn't exist by batter hand: with a hand filter, OPS- takes its place. */}
        {as?.vsHand || hs?.vsHand
          ? <PitchBar label="OPS-" aVal={opsMinus(as)} hVal={opsMinus(hs)} ac={ac} hc={hc} delay={110} />
          : <PitchBar label="ERA"  aVal={stat(as?.era)}  hVal={stat(hs?.era)}  lowerIsBetter ac={ac} hc={hc} delay={110} />}
        <PitchBar label="WHIP" aVal={stat(as?.whip)} hVal={stat(hs?.whip)} lowerIsBetter ac={ac} hc={hc} delay={220} />
      </div>

      {/* ── Stat glossary overlay ─────────────────────────────────── */}
      <CardModal
        isOpen={glossaryOpen} onClose={() => setGlossaryOpen(false)}
        title={t('statGlossary')}
        awayColor={awayColor} homeColor={homeColor} mode="comparison"
      >
        <div className={styles.glossaryList}>
          {GLOSSARY.map(({ stat, descKey }) => (
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
          { label: 'xFIP',  val: as?.xfip   ? as.xfip.toFixed(2) : '—' },
          wobaChip(as),
        ]}
        home={[
          { label: 'K-BB%', val: kbbPct(hs) },
          { label: 'xFIP',  val: hs?.xfip   ? hs.xfip.toFixed(2) : '—' },
          wobaChip(hs),
        ]}
      />
    </div>
  )
}

/* ── Opener / bulk ───────────────────────────────────────────────── */

type SideRole = 'opener' | 'bulk'

interface SideView {
  info?: PitcherInfo      // the arm shown (its numbers drive the bars and chips)
  name: string
  opener: boolean         // the probable starter is an opener
  bulk?: BulkArm          // probable bulk arm, when named
  role: SideRole          // which one is shown (only matters with a bulk)
}

function sideView(probable: PitcherInfo | undefined, fallbackName: string | undefined, opener: boolean | undefined,
  bulk: BulkArm | undefined, bulkInfo: PitcherInfo | undefined, role: SideRole): SideView {
  const openerName = probable?.fullName ?? fallbackName ?? 'TBD'
  const showBulk = !!opener && !!bulk && role === 'bulk'
  return {
    info: showBulk ? bulkInfo : probable,
    name: showBulk ? bulk!.fullName : openerName,
    opener: !!opener,
    bulk: opener ? bulk : undefined,
    role: showBulk ? 'bulk' : 'opener',
  }
}

function PitcherHeader({ side, view, onRole, onBullpen }: {
  side: 'away' | 'home'; view: SideView; onRole: (r: SideRole) => void; onBullpen: () => void
}) {
  const t = useT()
  const right = side === 'home'
  const { info, bulk } = view
  const s = info?.seasonStats

  const photo = info && (
    <img
      key={info.id}
      src={HEADSHOT(info.id)}
      alt={info.fullName}
      className={styles.headshot}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )

  return (
    <div className={styles.sideWrap}>
      {/* Opener | Bulk, same segmented style as the lineup card's switch: switches
          the arm shown. Without a named bulk arm it's Opener | Bullpen, and
          "Bullpen" scrolls down to the bullpen card. */}
      {view.opener && !bulk && (
        <div className={styles.roleTrack} title={t('openerNote')}>
          <div className={styles.rolePill} />
          <button type="button" className={`${styles.roleSegment} ${styles.roleSegmentActive}`} aria-current="true">
            {t('opener')}
          </button>
          <button type="button" className={styles.roleSegment} onClick={onBullpen}>
            {t('bullpen')}
          </button>
        </div>
      )}
      {view.opener && bulk && (
        <div className={styles.roleTrack} role="tablist" aria-label={t('openerOrBulk')} title={t('bulkTitle')}>
          <div className={styles.rolePill} style={{ transform: `translateX(${view.role === 'bulk' ? 100 : 0}%)` }} />
          {(['opener', 'bulk'] as const).map(r => (
            <button key={r} type="button" role="tab" aria-selected={view.role === r}
              className={`${styles.roleSegment} ${view.role === r ? styles.roleSegmentActive : ''}`}
              onClick={() => onRole(r)}>
              {r === 'bulk' ? t('bulkTag') : t('opener')}
            </button>
          ))}
        </div>
      )}
      <div className={`${styles.pitcherSide} ${right ? styles.pitcherSideRight : ''}`}>
        {!right && photo}
        <div className={styles.pitcherInfo} style={right ? { textAlign: 'right' } : undefined}>
          <div className={styles.pitcherName}>{view.name}</div>
          {s && (
            <div className={styles.pitcherRecord}>
              {s.wins}-{s.losses} · {s.inningsPitched} IP · {s.qualityStarts} QS
            </div>
          )}
          {/* The bulk arm is our prediction, never MLB's: always marked as projected. */}
          {view.role === 'bulk' && bulk && (
            <span className={styles.projectedTag} title={t('bulkTitle')}>{t('projected')}</span>
          )}
        </div>
        {right && photo}
      </div>
    </div>
  )
}

/**
 * Shows that team's side (the view is shared by the cards, like their own
 * switches), then scrolls to the bullpen card and highlights it for a moment.
 */
function goToBullpen(side: 'away' | 'home', setMode?: (m: ViewMode) => void) {
  setMode?.(side)
  // Wait for the new view to render: the cards above change height with it.
  window.setTimeout(() => {
    const card = document.getElementById(BULLPEN_CARD_ID)
    if (!card) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    card.removeAttribute('data-flash')
    void card.offsetWidth   // restart the animation if tapped twice
    card.setAttribute('data-flash', '')
    window.setTimeout(() => card.removeAttribute('data-flash'), 1300)
  }, 60)
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
  { stat: 'OPS-',  descKey: 'glossaryOpsMinusDesc' },
  { stat: 'WHIP',  descKey: 'glossaryWhipDesc' },
  { stat: 'K-BB%', descKey: 'glossaryKbbDesc' },
  { stat: 'xFIP',  descKey: 'glossaryXfipDesc' },
  { stat: 'wOBA',  descKey: 'glossaryWobaAgainstDesc' },
]

/** MLB uses '-.--' for "no value" (and ERA can't be split by batter hand): show nothing. */
function stat(v: string | undefined): string | undefined {
  return v && !v.startsWith('-.') ? v : undefined
}

/** OPS- = 200 − OPS+ allowed, so higher is better like FIP+ (100 = average). */
function opsMinus(s: PitcherSeasonStats | undefined): string | undefined {
  return s?.opsPlusAgainst != null ? String(200 - s.opsPlusAgainst) : undefined
}

/** wOBA allowed from our backend: follows the period and batter-hand filters. */
function wobaChip(s: PitcherSeasonStats | undefined): { label: string; val: string } {
  const w = s?.wobaAgainst
  return { label: 'wOBA', val: w != null ? w.toFixed(3).replace(/^0/, '') : '—' }
}

/* ── Bar helpers ─────────────────────────────────────────────────── */

function PitchBar({ label, aVal, hVal, lowerIsBetter = false, ac, hc, aw, hw, delay = 0 }: {
  label: string; aVal?: string; hVal?: string; lowerIsBetter?: boolean
  ac: string; hc: string; aw?: number; hw?: number
  delay?: number   // cascade stagger, in ms
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
      delay={delay}
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
  } else if (label === 'OPS-') {
    // OPS- (higher is better): range [40, 160], avg 100 → 50%
    const c = Math.max(40, Math.min(160, v))
    norm = lowerIsBetter ? (160 - c) / 120 : (c - 40) / 120
  } else {
    // WHIP: range [0.7, 1.9], avg 1.3 → 50%
    norm = lowerIsBetter
      ? (1.9 - Math.max(0.7, Math.min(1.9, v))) / 1.2
      : (Math.max(0.7, Math.min(1.9, v)) - 0.7) / 1.2
  }
  return Math.round(norm * 100)
}

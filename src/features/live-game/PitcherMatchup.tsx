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
import { cutoutUrl, teamLogoUrl } from './mlbImages'

interface Props {
  awayPitcher?: PitcherInfo
  homePitcher?: PitcherInfo
  awayColor: string
  homeColor: string
  awayBarColor?: string
  homeBarColor?: string
  awayPitcherName?: string
  homePitcherName?: string
  /** Probable starter is an opener (an inning or two, then the bullpen): tagged. */
  awayOpener?: boolean
  /** Starters not announced yet: projected from the rotation. */
  awayProjected?: boolean
  homeProjected?: boolean
  homeOpener?: boolean
  /** For the team logos behind each half. */
  awayTeamId?: number
  homeTeamId?: number
  mode: ViewMode
}

const CUTOUT = (id: number) => cutoutUrl(id)
const TEAM_LOGO = teamLogoUrl

export default function PitcherMatchup({ awayPitcher, homePitcher, awayColor, homeColor, awayBarColor, homeBarColor, awayPitcherName, homePitcherName, awayOpener, homeOpener, awayProjected, homeProjected, awayTeamId, homeTeamId, mode }: Props) {
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const t = useT()
  const ac = awayBarColor ?? awayColor
  const hc = homeBarColor ?? homeColor

  const away: SideView = { info: awayPitcher, name: awayPitcher?.fullName ?? awayPitcherName ?? 'TBD', opener: !!awayOpener, projected: !!awayProjected }
  const home: SideView = { info: homePitcher, name: homePitcher?.fullName ?? homePitcherName ?? 'TBD', opener: !!homeOpener, projected: !!homeProjected }
  const as = away.info?.seasonStats
  const hs = home.info?.seasonStats

  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />
      {/* TV-graphic look: a big faded team logo behind each half, and each
          pitcher's cutout on its outer edge, fading out behind the bars. */}
      <div className={styles.hero} data-card-bg aria-hidden="true">
        {/* Each logo is clipped to its own half, so they never meet in the middle */}
        <div className={`${styles.heroHalf} ${styles.heroHalfAway}`}>
          {awayTeamId && <img className={styles.heroLogo} src={TEAM_LOGO(awayTeamId)} alt="" />}
        </div>
        <div className={`${styles.heroHalf} ${styles.heroHalfHome}`}>
          {homeTeamId && <img className={styles.heroLogo} src={TEAM_LOGO(homeTeamId)} alt="" />}
        </div>
        {away.info && <img key={away.info.id} className={`${styles.heroPhoto} ${styles.heroAway}`} src={CUTOUT(away.info.id)} alt="" />}
        {home.info && <img key={home.info.id} className={`${styles.heroPhoto} ${styles.heroHome}`} src={CUTOUT(home.info.id)} alt="" />}
      </div>

      {/* ── Pitcher headers ────────────────────────────────────────── */}
      <div className={styles.pitcherRow}>
        <div className={styles.sidesRow}>
          <PitcherHeader side="away" view={away} />
          <button className={styles.glossaryBtn} onClick={() => setGlossaryOpen(true)}>?</button>
          <PitcherHeader side="home" view={home} />
        </div>
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

/* ── Pitcher header ──────────────────────────────────────────────── */

interface SideView {
  info?: PitcherInfo
  name: string
  opener: boolean     // the probable starter is an opener
  projected: boolean  // not announced: projected from the rotation
}

function PitcherHeader({ side, view }: { side: 'away' | 'home'; view: SideView }) {
  const t = useT()
  const right = side === 'home'
  const s = view.info?.seasonStats
  // TV style: first name small on top, last name big. "Ranger Suarez" → RANGER / SUAREZ.
  const [first, ...rest] = view.name.split(' ')
  const last = rest.join(' ') || first
  const hand = view.info?.pitchHand

  // The photo and logo are drawn behind (see .hero); this is the text, on the inner side.
  return (
    <div className={`${styles.pitcherSide} ${right ? styles.pitcherSideRight : ''}`}>
      <div className={styles.pitcherInfo}>
        {/* "Projected" rides on the first-name line: three chips don't fit a phone's half */}
        {(rest.length > 0 || view.projected) && (
          <div className={styles.firstName}>
            {rest.length > 0 && first}
            {view.projected && <span className={styles.projMark} title={t('projectedStarterNote')}>{rest.length > 0 ? ' · ' : ''}{t('projectedShort')}</span>}
          </div>
        )}
        <div className={styles.pitcherName} title={view.name}>{last}</div>
        {s && <div className={styles.pitcherRecord}>{s.wins}-{s.losses} · {s.inningsPitched} IP</div>}
        {(hand || view.opener) && (
          <div className={styles.tagRow}>
            {hand && <span className={styles.tag}>{hand}HP</span>}
            {view.opener && <span className={styles.tag} title={t('openerNote')}>{t('opener')}</span>}
          </div>
        )}
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

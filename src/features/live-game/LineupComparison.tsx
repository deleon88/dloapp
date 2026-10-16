import { createContext, useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBatSides } from '@/api/mlb/endpoints/people'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import type { PlayerStats } from '@/api/mlb/endpoints/lineupStats'
import { getTeamMeta, getBarColor, capLogoUrl } from '@/data/teams'
import { useT } from '@/i18n/useT'
import { BarFill, CountUp } from '@/components/AnimatedBar/AnimatedBar'
import CardBgLayers from './CardBgLayers'
import FieldingAlignmentModal from './FieldingAlignmentModal'
import VsPitcherModal from './VsPitcherModal'
import styles from './LineupComparison.module.css'
import { cutoutUrl } from './mlbImages'

export type ViewMode = 'away' | 'comparison' | 'home'

export type LineupStatus = 'confirmed' | 'projected'

interface ProbablePitcher { id: number; fullName: string }

/** Batting side (L / R / S) by player id, for the badge on each photo. */
const BatSides = createContext<Map<number, string> | undefined>(undefined)

interface Props {
  awayTeamId: number
  homeTeamId: number
  awayLineup: LineupSlot[]
  homeLineup: LineupSlot[]
  wrcMap: Map<number, PlayerStats>
  isLoading?: boolean
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
  awayLineupStatus?: LineupStatus
  homeLineupStatus?: LineupStatus
  awayProbablePitcher?: ProbablePitcher
  homeProbablePitcher?: ProbablePitcher
}

const WRC_MIN = 40
const WRC_MAX = 160
const AVG_MARK_PCT = ((100 - WRC_MIN) / (WRC_MAX - WRC_MIN)) * 100 // 50%
/** Delay between lineup rows in the bar cascade, in ms. */
const ROW_STAGGER_MS = 60

function barPct(wrc: number): number {
  return Math.max(0, Math.min(100, ((wrc - WRC_MIN) / (WRC_MAX - WRC_MIN)) * 100))
}

function lineupAvgWrc(lineup: LineupSlot[], wrcMap: Map<number, PlayerStats>): number | null {
  let sumWrcPa = 0
  let sumPa = 0
  for (const p of lineup) {
    const s = wrcMap.get(p.id)
    if (s?.wRcPlus == null) continue
    const pa = s.pa ?? p.pa ?? 1
    sumWrcPa += s.wRcPlus * pa
    sumPa += pa
  }
  if (sumPa === 0) return null
  return Math.round(sumWrcPa / sumPa)
}

interface LineupChipStats { ops: string; woba: string; xwoba: string }

function avgRate(vals: (string | null)[]): string {
  const nums = vals.map(v => parseFloat(v ?? '')).filter(v => !isNaN(v))
  if (!nums.length) return '—'
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length
  return avg.toFixed(3).replace(/^0/, '')
}

function lineupChipStats(lineup: LineupSlot[], wrcMap: Map<number, PlayerStats>): LineupChipStats | null {
  const stats = lineup.map(p => wrcMap.get(p.id)).filter((s): s is PlayerStats => s != null)
  if (!stats.length) return null
  return {
    ops:   avgRate(stats.map(s => s.ops)),
    woba:  avgRate(stats.map(s => s.woba)),
    xwoba: avgRate(stats.map(s => s.xwoba)),
  }
}

function lastName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : parts.slice(1).join(' ')
}

export default function LineupComparison({
  awayTeamId, homeTeamId,
  awayLineup, homeLineup,
  wrcMap, isLoading,
  mode, onModeChange,
  awayLineupStatus, homeLineupStatus,
  awayProbablePitcher, homeProbablePitcher,
}: Props) {
  const awayMeta = getTeamMeta(awayTeamId)
  const homeMeta = getTeamMeta(homeTeamId)
  const awayColor = awayMeta?.color ?? '#888'
  const homeColor = homeMeta?.color ?? '#888'
  const awayBarColor = awayMeta ? getBarColor(awayMeta) : awayColor
  const homeBarColor = homeMeta ? getBarColor(homeMeta) : homeColor

  const awayLabel = awayMeta?.brief.toUpperCase() ?? 'AWAY'
  const homeLabel = homeMeta?.brief.toUpperCase() ?? 'HOME'

  // Batting side of everyone in both lineups, shown like the bullpen's throwing hand.
  const batterIds = [...awayLineup, ...homeLineup].map(p => p.id).sort((a, b) => a - b)
  const batSidesQuery = useQuery({
    queryKey: ['bat-sides', ...batterIds],
    queryFn: () => getBatSides(batterIds),
    enabled: batterIds.length > 0,
    staleTime: 24 * 3_600_000,
    placeholderData: prev => prev,
  })

  const pillIndex = mode === 'away' ? 0 : mode === 'comparison' ? 1 : 2
  const pillColor = mode === 'away' ? awayColor : mode === 'home' ? homeColor : null

  const [fieldingOpen, setFieldingOpen] = useState(false)
  const [vsPitcherOpen, setVsPitcherOpen] = useState(false)
  const t = useT()

  const activeSide    = mode as 'away' | 'home'
  const activeLineup  = mode === 'home' ? homeLineup   : awayLineup
  const activeColor   = mode === 'home' ? homeBarColor : awayBarColor
  const activeBgColor = mode === 'home' ? homeColor    : awayColor
  const activeLabel   = mode === 'home' ? homeLabel    : awayLabel
  const activeStatus  = mode === 'home' ? homeLineupStatus : awayLineupStatus
  const opposingPitcher = mode === 'home' ? awayProbablePitcher : homeProbablePitcher

  return (
    <BatSides.Provider value={batSidesQuery.data}>
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

      {/* ── Segmented toggle ── */}
      <div className={styles.segmentTrack}>
        <div
          className={styles.segmentPill}
          style={{
            transform: `translateX(${pillIndex * 100}%)`,
            ...(pillColor ? { boxShadow: `0 0 0 1px ${pillColor}40` } : {}),
          }}
        />
        <button
          className={`${styles.segment} ${mode === 'away' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('away')}
          aria-label={awayMeta?.brief ?? awayLabel}
        >{mode === 'away' ? <img className={styles.segmentLogo} src={capLogoUrl(awayTeamId)} alt="" /> : awayLabel}</button>
        <button
          className={`${styles.segment} ${mode === 'comparison' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('comparison')}
        >{t('comparison')}</button>
        <button
          className={`${styles.segment} ${mode === 'home' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('home')}
          aria-label={homeMeta?.brief ?? homeLabel}
        >{mode === 'home' ? <img className={styles.segmentLogo} src={capLogoUrl(homeTeamId)} alt="" /> : homeLabel}</button>
      </div>

      {/* ── Status / action row ── */}
      {mode !== 'comparison' && (
        <div className={styles.statusRow}>
          {mode === 'away'
            ? <button className={`${styles.fieldingChip} ${styles.statusRowLeft}`} onClick={() => setFieldingOpen(true)}>{t('fieldingAlignment')}</button>
            : opposingPitcher
              ? <button className={`${styles.rivalChip} ${styles.statusRowLeft}`} onClick={() => setVsPitcherOpen(true)}>VS {lastName(opposingPitcher.fullName)}</button>
              : null
          }
          <StatusBadge status={activeStatus} />
          {mode === 'home'
            ? <button className={`${styles.fieldingChip} ${styles.statusRowRight}`} onClick={() => setFieldingOpen(true)}>{t('fieldingAlignment')}</button>
            : opposingPitcher
              ? <button className={`${styles.rivalChip} ${styles.statusRowRight}`} onClick={() => setVsPitcherOpen(true)}>VS {lastName(opposingPitcher.fullName)}</button>
              : null
          }
        </div>
      )}
      {isLoading && <p className={styles.loading}>{t('loadingLineup')}</p>}

      {!isLoading && mode === 'comparison' && (
        <ComparisonView
          awayLineup={awayLineup}
          homeLineup={homeLineup}
          awayColor={awayBarColor}
          homeColor={homeBarColor}
          wrcMap={wrcMap}
          awayLineupStatus={awayLineupStatus}
          homeLineupStatus={homeLineupStatus}
        />
      )}

      {!isLoading && mode === 'away' && (
        <SingleView lineup={awayLineup} color={awayBarColor} wrcMap={wrcMap} />
      )}

      {!isLoading && mode === 'home' && (
        <SingleView lineup={homeLineup} color={homeBarColor} wrcMap={wrcMap} />
      )}

      {/* ── Fielding alignment inline overlay ── */}
      <FieldingAlignmentModal
        isOpen={fieldingOpen}
        onClose={() => setFieldingOpen(false)}
        lineup={activeLineup}
        color={activeColor}
        bgColor={activeBgColor}
        side={activeSide}
        label={activeLabel}
      />

      {/* ── vs Pitcher inline overlay ── */}
      {opposingPitcher && (
        <VsPitcherModal
          isOpen={vsPitcherOpen}
          onClose={() => setVsPitcherOpen(false)}
          lineup={activeLineup}
          pitcherId={opposingPitcher.id}
          pitcherName={opposingPitcher.fullName}
          bgColor={activeBgColor}
          side={activeSide}
          teamLabel={activeLabel}
        />
      )}
    </div>
    </BatSides.Provider>
  )
}

/* ── Comparison view ─────────────────────────────────────────── */

function ComparisonView({
  awayLineup, homeLineup,
  awayColor, homeColor,
  wrcMap,
  awayLineupStatus, homeLineupStatus,
}: {
  awayLineup: LineupSlot[]; homeLineup: LineupSlot[]
  awayColor: string; homeColor: string
  wrcMap: Map<number, PlayerStats>
  awayLineupStatus?: LineupStatus
  homeLineupStatus?: LineupStatus
}) {
  const t = useT()
  const slots = Math.max(awayLineup.length, homeLineup.length, 9)
  const totalsDelay = slots * ROW_STAGGER_MS   // totals fill after the last row
  const aAvg = lineupAvgWrc(awayLineup, wrcMap)
  const hAvg = lineupAvgWrc(homeLineup, wrcMap)
  const aChips = lineupChipStats(awayLineup, wrcMap)
  const hChips = lineupChipStats(homeLineup, wrcMap)

  return (
    <div className={styles.tv}>
      {/* Lineup status of each side, and what the bars mean */}
      <div className={styles.tvStatus}>
        <StatusBadge status={awayLineupStatus} align="left" />
        <span className={styles.tvColLabel}>wRC+</span>
        <StatusBadge status={homeLineupStatus} align="right" />
      </div>

      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} className={styles.tvRow}>
          <TvBatter side="away" player={awayLineup[i]} wrcMap={wrcMap} color={awayColor} delay={i * ROW_STAGGER_MS} />
          <span className={styles.tvSlot}>{i + 1}</span>
          <TvBatter side="home" player={homeLineup[i]} wrcMap={wrcMap} color={homeColor} delay={i * ROW_STAGGER_MS} />
        </div>
      ))}

      {/* Team totals (PA-weighted wRC+ of each lineup), laid out like the batter
          rows: thick bar growing toward the middle, value next to it. */}
      <div className={`${styles.tvRow} ${styles.tvTotals}`}>
        <TvTotal side="away" value={aAvg} color={awayColor} delay={totalsDelay} label={t('lineupWord')} />
        <span />
        <TvTotal side="home" value={hAvg} color={homeColor} delay={totalsDelay} label={t('lineupWord')} />
      </div>

      {/* Same chips as the pitcher card */}
      <div className={styles.tvChipView}>
        {[aChips, hChips].map((c, k) => (
          <div key={k} className={`${styles.tvChipGroup} ${k ? styles.tvChipGroupRight : ''}`}>
            {(['ops', 'woba', 'xwoba'] as const).map(key => (
              <div key={key} className={styles.tvChip}>
                <span className={styles.tvChipLabel}>{key === 'ops' ? 'OPS' : key === 'woba' ? 'wOBA' : 'xwOBA'}</span>
                <span className={styles.tvChipVal}>{c?.[key] ?? '—'}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A team's lineup wRC+ on the batter-row grid: label where the photo goes. */
function TvTotal({ side, value, color, delay, label }: {
  side: 'away' | 'home'; value: number | null; color: string; delay: number; label: string
}) {
  const home = side === 'home'
  const tag = <span className={styles.tvTotalLabel}>{label}</span>
  return (
    <div className={`${styles.tvBatter} ${home ? styles.tvBatterHome : ''}`}>
      {!home && tag}
      <div className={`${styles.tvLine} ${styles.tvTotalLine}`}>
        <div className={`${styles.barTrack} ${styles.tvTotalTrack}`}>
          <BarFill className={home ? styles.barFillLeft : styles.barFillRight} width={value != null ? barPct(value) : 0} color={color} delay={delay} />
          <div className={styles.avgMark} style={home ? { left: `${AVG_MARK_PCT}%` } : { right: `${AVG_MARK_PCT}%` }} />
        </div>
        <span className={styles.tvTotalVal}><CountUp value={value} delay={delay} /></span>
      </div>
      {home && tag}
    </div>
  )
}

/**
 * First name (small) + LAST NAME in caps, with the batting-side chip (L / R / S).
 * When space runs out the first name gives way first.
 */
function TvName({ player }: { player: LineupSlot }) {
  const bats = useContext(BatSides)?.get(player.id)
  const [first, ...rest] = player.fullName.trim().split(' ')
  return (
    <div className={styles.tvNameLine}>
      <span className={styles.tvFullName} title={player.fullName}>
        {rest.length > 0 && <span className={styles.tvFirst}>{first}</span>}
        <span className={styles.tvLast}>{rest.length ? rest.join(' ') : first}</span>
      </span>
      {bats && <span className={styles.tvBat} aria-label={BAT_LABEL[bats] ?? bats}>{bats}</span>}
    </div>
  )
}

/**
 * One batter, TV style: cutout on the outer edge, LAST NAME in caps with the
 * batting side, then position and the wRC+ bar growing toward the middle.
 */
function TvBatter({ side, player, wrcMap, color, delay }: {
  side: 'away' | 'home'; player?: LineupSlot; wrcMap: Map<number, PlayerStats>; color: string; delay: number
}) {
  const home = side === 'home'
  const wrc = player ? (wrcMap.get(player.id)?.wRcPlus ?? null) : null
  const photo = (
    <span className={styles.tvPhotoBox}>
      {player && (
        <img className={styles.tvPhoto} src={cutoutUrl(player.id, 96)} alt="" loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
      )}
    </span>
  )
  return (
    <div className={`${styles.tvBatter} ${home ? styles.tvBatterHome : ''}`}>
      {!home && photo}
      <div className={styles.tvWho}>
        {player ? <>
          <TvName player={player} />
          <div className={styles.tvLine}>
            <span className={styles.tvPos}>{player.pos}</span>
            <div className={styles.barTrack}>
              <BarFill className={home ? styles.barFillLeft : styles.barFillRight} width={wrc != null ? barPct(wrc) : 0} color={color} delay={delay} />
              <div className={styles.avgMark} style={home ? { left: `${AVG_MARK_PCT}%` } : { right: `${AVG_MARK_PCT}%` }} />
            </div>
            <span className={styles.tvVal}><CountUp value={wrc} delay={delay} /></span>
          </div>
        </> : <span className={styles.empty}>—</span>}
      </div>
      {home && photo}
    </div>
  )
}

/* ── Single-team view ────────────────────────────────────────── */

function SingleView({ lineup, color, wrcMap }: {
  lineup: LineupSlot[]; color: string; wrcMap: Map<number, PlayerStats>
}) {
  const slots = lineup.length > 0 ? lineup : Array(9).fill(null)
  const t = useT()

  const avg    = lineupAvgWrc(lineup, wrcMap)
  const avgPct = avg != null ? barPct(avg) : 0

  return (
    <div>
      <div className={styles.singleHeader}>
        <span>#</span>
        <span />
        <span>{t('batter')}</span>
        <span style={{ textAlign: 'center' }}>HR</span>
        <span style={{ textAlign: 'center' }}>RBI</span>
        <span style={{ textAlign: 'center' }}>SB</span>
        <span style={{ textAlign: 'center' }}>OPS</span>
        <span style={{ textAlign: 'center' }}>wOBA</span>
        <div className={styles.singleBarWrap}><div style={{ flex: 1 }} /><span style={{ minWidth: '22px', textAlign: 'center' }}>wRC+</span></div>
      </div>

      {slots.map((p: LineupSlot | null, i) => {
        const ps  = p ? (wrcMap.get(p.id) ?? null) : null
        const wrc = ps?.wRcPlus ?? null
        const pa  = ps?.pa ?? p?.pa ?? null
        const pct = wrc != null ? barPct(wrc) : 0

        return (
          <div key={i} className={styles.singleRow}>
            <span className={styles.slotNum}>{i + 1}</span>
            <span className={styles.tvPhotoBox}>
              {p && <img className={styles.tvPhoto} src={cutoutUrl(p.id, 96)} alt="" loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />}
            </span>
            <div className={styles.singleInfo}>
              {p
                ? <><TvName player={p} /><span className={styles.meta}>{p.pos}{pa != null ? ` · ${pa} PA` : ''}</span></>
                : <span className={styles.empty}>—</span>}
            </div>
            <span className={styles.statVal}>{ps?.hr  ?? '—'}</span>
            <span className={styles.statVal}>{ps?.rbi ?? '—'}</span>
            <span className={styles.statVal}>{ps?.sb  ?? '—'}</span>
            <span className={styles.statVal}>{ps?.ops ?? '—'}</span>
            <span className={styles.statVal}>{ps?.woba ?? '—'}</span>
            <div className={styles.singleBarWrap}>
              <div className={styles.barTrack}>
                <BarFill className={styles.barFillLeft} width={pct} color={color} delay={i * ROW_STAGGER_MS} />
                <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
              </div>
              <span className={styles.wrc}><CountUp value={wrc} delay={i * ROW_STAGGER_MS} /></span>
            </div>
          </div>
        )
      })}

      {/* Totals row — bar spans from HR col to end (desktop) / full width (mobile) */}
      <div className={styles.singleTotalsRow}>
        <span />
        <span />
        <span className={`${styles.singleTotalsLabel} ${styles.tvTotalLabel}`} title={t('wrcWeighted')}>{t('lineupWord')}</span>
        <div className={`${styles.singleBarWrap} ${styles.singleTotalsBarWrap}`}>
          <div className={`${styles.barTrack} ${styles.tvTotalTrack}`}>
            <BarFill className={styles.barFillLeft} width={avgPct} color={color} delay={slots.length * ROW_STAGGER_MS} />
            <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
          </div>
          <span className={styles.tvTotalVal}><CountUp value={avg} delay={slots.length * ROW_STAGGER_MS} /></span>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status, align = 'center' }: { status?: LineupStatus; align?: 'left' | 'center' | 'right' }) {
  const t = useT()
  if (!status) return null
  const justifySelf = align === 'left' ? 'start' : align === 'right' ? 'end' : 'center'
  return (
    <span
      className={status === 'confirmed' ? styles.statusConfirmed : styles.statusProjected}
      style={{ justifySelf }}
    >
      {status === 'confirmed' ? t('confirmed') : t('projected')}
    </span>
  )
}

const BAT_LABEL: Record<string, string> = { L: 'Bats left', R: 'Bats right', S: 'Switch hitter' }


import { useState, type CSSProperties } from 'react'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import type { PlayerStats } from '@/api/mlb/endpoints/lineupStats'
import { getTeamMeta, getBarColor } from '@/data/teams'
import { useT } from '@/i18n/useT'
import CardBgLayers from './CardBgLayers'
import FieldingAlignmentModal from './FieldingAlignmentModal'
import styles from './LineupComparison.module.css'

export type ViewMode = 'away' | 'comparison' | 'home'

export type LineupStatus = 'confirmed' | 'projected'

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
}

const WRC_MIN = 60
const WRC_MAX = 160
const AVG_MARK_PCT = ((100 - WRC_MIN) / (WRC_MAX - WRC_MIN)) * 100 // 40%

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

function fmtName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

function lastName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : parts.slice(1).join(' ')
}

function photo(id: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_64,q_auto:best/v1/people/${id}/headshot/67/current`
}


export default function LineupComparison({
  awayTeamId, homeTeamId,
  awayLineup, homeLineup,
  wrcMap, isLoading,
  mode, onModeChange,
  awayLineupStatus, homeLineupStatus,
}: Props) {
  const awayMeta = getTeamMeta(awayTeamId)
  const homeMeta = getTeamMeta(homeTeamId)
  const awayColor = awayMeta?.color ?? '#888'
  const homeColor = homeMeta?.color ?? '#888'
  const awayBarColor = awayMeta ? getBarColor(awayMeta) : awayColor
  const homeBarColor = homeMeta ? getBarColor(homeMeta) : homeColor

  const awayLabel = awayMeta?.brief.toUpperCase() ?? 'AWAY'
  const homeLabel = homeMeta?.brief.toUpperCase() ?? 'HOME'

  const pillIndex = mode === 'away' ? 0 : mode === 'comparison' ? 1 : 2
  const pillColor = mode === 'away' ? awayColor : mode === 'home' ? homeColor : null

  const [fieldingOpen, setFieldingOpen] = useState(false)
  const t = useT()

  const activeSide    = mode as 'away' | 'home'
  const activeLineup  = mode === 'home' ? homeLineup   : awayLineup
  const activeColor   = mode === 'home' ? homeBarColor : awayBarColor
  const activeBgColor = mode === 'home' ? homeColor    : awayColor
  const activeLabel   = mode === 'home' ? homeLabel    : awayLabel

  return (
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
        >{awayLabel}</button>
        <button
          className={`${styles.segment} ${mode === 'comparison' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('comparison')}
        >{t('comparison')}</button>
        <button
          className={`${styles.segment} ${mode === 'home' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('home')}
        >{homeLabel}</button>
      </div>

      {/* ── Lineup status row ── */}
      {(awayLineupStatus || homeLineupStatus) && (
        <div className={styles.statusRow}>
          <StatusBadge status={mode !== 'home' ? awayLineupStatus : undefined} align="left" />
          {mode !== 'comparison' ? (
            <button
              className={styles.fieldingChip}
              onClick={() => setFieldingOpen(true)}
            >
              {t('fieldingAlignment')}
            </button>
          ) : (
            <span />
          )}
          <StatusBadge status={mode !== 'away' ? homeLineupStatus : undefined} align="right" />
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
    </div>
  )
}

/* ── Comparison view ─────────────────────────────────────────── */

function ComparisonView({
  awayLineup, homeLineup,
  awayColor, homeColor,
  wrcMap,
}: {
  awayLineup: LineupSlot[]; homeLineup: LineupSlot[]
  awayColor: string; homeColor: string
  wrcMap: Map<number, PlayerStats>
}) {
  const slots = Math.max(awayLineup.length, homeLineup.length, 9)
  const aAvg = lineupAvgWrc(awayLineup, wrcMap)
  const hAvg = lineupAvgWrc(homeLineup, wrcMap)
  const aChips = lineupChipStats(awayLineup, wrcMap)
  const hChips = lineupChipStats(homeLineup, wrcMap)

  return (
    <div>
      {/* Column header: mirrors compRow grid exactly */}
      <div className={styles.compHeader}>
        <span /><span /><span />
        {/* away: [guide track] [wRC+ where value would be] */}
        <div className={styles.barBlockAway}>
          <div className={styles.barTrackGuide}>
            <span className={styles.compBarSide} style={{ left: `${100 - AVG_MARK_PCT}%` }}>100</span>
          </div>
          <span className={styles.compBarLabel}>wRC+</span>
        </div>
        <div className={styles.barBlockHome}>
          <span className={styles.compBarLabel}>wRC+</span>
          <div className={styles.barTrackGuide}>
            <span className={styles.compBarSide} style={{ left: `${AVG_MARK_PCT}%` }}>100</span>
          </div>
        </div>
        <span /><span /><span />
      </div>

      {/* Player rows */}
      {Array.from({ length: slots }).map((_, i) => {
        const a = awayLineup[i]
        const h = homeLineup[i]
        const aWrc = a ? (wrcMap.get(a.id)?.wRcPlus ?? null) : null
        const hWrc = h ? (wrcMap.get(h.id)?.wRcPlus ?? null) : null
        const aPct = aWrc != null ? barPct(aWrc) : 0
        const hPct = hWrc != null ? barPct(hWrc) : 0

        return (
          <div key={i} className={styles.compRow}>
            <div className={styles.slotNum}>{i + 1}</div>
            <PlayerPhoto id={a?.id} name={a?.fullName} />

            <div className={styles.playerAway}>
              {a ? <>
                <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(a.fullName)}</span>
                <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(a.fullName)}</span>
                <span className={styles.meta}><span className={styles.posText}>{a.pos} · </span>{a.pa != null ? `${a.pa} PA` : a.avg}</span>
              </> : <span className={styles.empty}>—</span>}
            </div>

            {/* Away bar (right-anchored) + wRC+ value */}
            <div className={styles.barBlockAway}>
              <div className={styles.barTrack}>
                <div className={styles.barFillRight} style={{ '--bar-width': `${aPct}%`, background: awayColor } as CSSProperties} />
                <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
              </div>
              <span className={styles.wrc}>{aWrc ?? '—'}</span>
            </div>

            {/* Home bar (left-anchored) + wRC+ value */}
            <div className={styles.barBlockHome}>
              <span className={styles.wrc}>{hWrc ?? '—'}</span>
              <div className={styles.barTrack}>
                <div className={styles.barFillLeft} style={{ '--bar-width': `${hPct}%`, background: homeColor } as CSSProperties} />
                <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
              </div>
            </div>

            <div className={styles.playerHome}>
              {h ? <>
                <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(h.fullName)}</span>
                <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(h.fullName)}</span>
                <span className={styles.meta}><span className={styles.posText}>{h.pos} · </span>{h.pa != null ? `${h.pa} PA` : h.avg}</span>
              </> : <span className={styles.empty}>—</span>}
            </div>

            <PlayerPhoto id={h?.id} name={h?.fullName} />
            <div className={styles.slotNum}>{i + 1}</div>
          </div>
        )
      })}

      {/* ── Totals row ── */}
      <div className={styles.totalsRow}>
        {/* ── Row 1: wRC+ values + bars aligned ── */}
        <div className={`${styles.totalsWrcOuter} ${styles.totalsWrcAway}`}>
          {aAvg ?? '—'}
        </div>

        <div className={styles.totalsBarAway}>
          <div className={styles.barTrack} style={{ width: '100%', flex: 'none' }}>
            <div className={styles.barFillRight} style={{ '--bar-width': `${aAvg != null ? barPct(aAvg) : 0}%`, background: awayColor } as CSSProperties} />
            <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
          </div>
        </div>

        <div className={styles.totalsBarHome}>
          <div className={styles.barTrack} style={{ width: '100%', flex: 'none' }}>
            <div className={styles.barFillLeft} style={{ '--bar-width': `${hAvg != null ? barPct(hAvg) : 0}%`, background: homeColor } as CSSProperties} />
            <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
          </div>
        </div>

        <div className={`${styles.totalsWrcOuter} ${styles.totalsWrcHome}`}>
          {hAvg ?? '—'}
        </div>

        {/* ── Row 2: chips spanning full half ── */}
        <div className={`${styles.totalsChipGrid} ${styles.totalsChipAway}`}>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>OPS</span>
            <span className={styles.totalsChipVal}>{aChips?.ops ?? '—'}</span>
          </div>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>wOBA</span>
            <span className={styles.totalsChipVal}>{aChips?.woba ?? '—'}</span>
          </div>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>xwOBA</span>
            <span className={styles.totalsChipVal}>{aChips?.xwoba ?? '—'}</span>
          </div>
        </div>

        <div className={`${styles.totalsChipGrid} ${styles.totalsChipHome}`}>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>OPS</span>
            <span className={styles.totalsChipVal}>{hChips?.ops ?? '—'}</span>
          </div>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>wOBA</span>
            <span className={styles.totalsChipVal}>{hChips?.woba ?? '—'}</span>
          </div>
          <div className={styles.totalsChip}>
            <span className={styles.totalsChipLabel}>xwOBA</span>
            <span className={styles.totalsChipVal}>{hChips?.xwoba ?? '—'}</span>
          </div>
        </div>
      </div>
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
        <span style={{ textAlign: 'center' }}>OPS</span>
        <span style={{ textAlign: 'center' }}>wOBA</span>
        <div className={styles.singleBarWrap}><div style={{ flex: 1 }} /><span style={{ minWidth: '22px', textAlign: 'center' }}>wRC+</span></div>
      </div>

      {slots.map((p: LineupSlot | null, i) => {
        const ps  = p ? (wrcMap.get(p.id) ?? null) : null
        const wrc = ps?.wRcPlus ?? null
        const pct = wrc != null ? barPct(wrc) : 0

        return (
          <div key={i} className={styles.singleRow}>
            <span className={styles.slotNum}>{i + 1}</span>
            <PlayerPhoto id={p?.id} name={p?.fullName} />
            <div className={styles.singleInfo}>
              {p
                ? <><span className={styles.name}>{fmtName(p.fullName)}</span><span className={styles.meta}>{p.pos}</span></>
                : <span className={styles.empty}>—</span>}
            </div>
            <span className={styles.statVal}>{ps?.ops ?? '—'}</span>
            <span className={styles.statVal}>{ps?.woba ?? '—'}</span>
            <div className={styles.singleBarWrap}>
              <div className={styles.barTrack}>
                <div className={styles.barFillLeft} style={{ '--bar-width': `${pct}%`, background: color } as CSSProperties} />
                <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
              </div>
              <span className={styles.wrc}>{wrc ?? '—'}</span>
            </div>
          </div>
        )
      })}

      {/* Totals row: matches comparison height — aggregate bar + 6 blank chips */}
      <div className={styles.totalsRow}>
        <div className={styles.singleTotalsBar}>
          <div className={styles.barTrack} style={{ flex: 1 }}>
            <div className={styles.barFillLeft} style={{ '--bar-width': `${avgPct}%`, background: color } as CSSProperties} />
            <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
          </div>
          <span className={styles.wrc}>{avg ?? '—'}</span>
        </div>
        <div className={styles.singleTotalsChips}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.totalsChip} />
          ))}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status, align }: { status?: LineupStatus; align: 'left' | 'right' }) {
  const t = useT()
  if (!status) return <span />
  return (
    <span
      className={status === 'confirmed' ? styles.statusConfirmed : styles.statusProjected}
      style={{ justifySelf: align === 'left' ? 'start' : 'end' }}
    >
      {status === 'confirmed' ? t('confirmed') : t('projected')}
    </span>
  )
}

function PlayerPhoto({ id, name }: { id?: number; name?: string }) {
  return (
    <div className={styles.photoWrap}>
      {id && (
        <img
          className={styles.photo}
          src={photo(id)}
          alt={name ?? ''}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
        />
      )}
    </div>
  )
}

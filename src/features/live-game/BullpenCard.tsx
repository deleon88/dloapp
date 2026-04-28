import { type CSSProperties } from 'react'
import type { BullpenStats, BullpenPitcher } from '@/api/mlb/endpoints/bullpenStats'
import type { ViewMode } from './LineupComparison'
import CardBgLayers from './CardBgLayers'
import styles from './BullpenCard.module.css'

const FIP_MIN = 70
const FIP_MAX = 130
const AVG_MARK_PCT = ((100 - FIP_MIN) / (FIP_MAX - FIP_MIN)) * 100  // 50%

function toFipPlus(fipMinus: number): number {
  return Math.round(200 - fipMinus)
}

function fipBarPct(fipMinus: number | null): number {
  if (fipMinus == null) return 0
  const fp = 200 - fipMinus
  return Math.max(0, Math.min(100, ((Math.max(FIP_MIN, Math.min(FIP_MAX, fp)) - FIP_MIN) / (FIP_MAX - FIP_MIN)) * 100))
}

function fmtName(n: string) {
  const p = n.split(' ')
  return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : n
}

function lastName(n: string) {
  const p = n.trim().split(' ')
  return p.length < 2 ? n : p.slice(1).join(' ')
}

const PHOTO = (id: number) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_64,q_auto:best/v1/people/${id}/headshot/67/current`

function PlayerPhoto({ id }: { id: number }) {
  return (
    <div className={styles.photoWrap}>
      <img
        className={styles.photo}
        src={PHOTO(id)}
        alt=""
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
      />
    </div>
  )
}

interface Props {
  away?: BullpenStats
  home?: BullpenStats
  awayColor: string
  homeColor: string
  awayBarColor?: string
  homeBarColor?: string
  awayLabel: string
  homeLabel: string
  isLoading?: boolean
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
}

export default function BullpenCard({
  away, home,
  awayColor, homeColor,
  awayBarColor, homeBarColor,
  awayLabel, homeLabel,
  isLoading,
  mode,
  onModeChange,
}: Props) {
  const ac = awayBarColor ?? awayColor
  const hc = homeBarColor ?? homeColor

  const pillIndex = mode === 'away' ? 0 : mode === 'comparison' ? 1 : 2
  const pillColor  = mode === 'away' ? awayColor : mode === 'home' ? homeColor : null

  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

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
        >Bullpen</button>
        <button
          className={`${styles.segment} ${mode === 'home' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('home')}
        >{homeLabel}</button>
      </div>

      {isLoading && <p className={styles.stateMsg}>…</p>}

      {!isLoading && (
        <div className={styles.viewStack}>
          {/* Hidden comparison always holds the max height */}
          {away && home && (
            <div className={styles.viewSizer} aria-hidden="true">
              <ComparisonView away={away} home={home} awayColor={ac} homeColor={hc} />
            </div>
          )}
          <div className={styles.viewContent}>
            {away && home && mode === 'comparison' && (
              <ComparisonView away={away} home={home} awayColor={ac} homeColor={hc} />
            )}
            {mode !== 'comparison' && (
              <SingleView stats={mode === 'away' ? away : home} color={mode === 'away' ? ac : hc} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Comparison view ─────────────────────────────────────────── */

function ComparisonView({
  away, home, awayColor, homeColor,
}: {
  away: BullpenStats; home: BullpenStats; awayColor: string; homeColor: string
}) {
  const rows     = Math.max(away.pitchers.length, home.pitchers.length)
  const aFipPlus = away.teamFipMinus != null ? toFipPlus(away.teamFipMinus) : null
  const hFipPlus = home.teamFipMinus != null ? toFipPlus(home.teamFipMinus) : null
  const aAggPct  = fipBarPct(away.teamFipMinus)
  const hAggPct  = fipBarPct(home.teamFipMinus)

  return (
    <div>
      {/* Column header */}
      <div className={styles.compHeader}>
        <span /> {/* photo */}
        <span /> {/* playerAway */}
        <div className={styles.barBlockAway}>
          <div className={styles.barTrackGuide}>
            <span className={styles.compBarSide} style={{ left: `${100 - AVG_MARK_PCT}%` }}>100</span>
          </div>
          <span className={styles.compBarLabel}>FIP+</span>
        </div>
        <div className={styles.barBlockHome}>
          <span className={styles.compBarLabel}>FIP+</span>
          <div className={styles.barTrackGuide}>
            <span className={styles.compBarSide} style={{ left: `${AVG_MARK_PCT}%` }}>100</span>
          </div>
        </div>
        <span /> {/* playerHome */}
        <span /> {/* photo */}
      </div>

      {/* Pitcher rows */}
      {Array.from({ length: rows }).map((_, i) => {
        const a    = away.pitchers[i] as BullpenPitcher | undefined
        const h    = home.pitchers[i] as BullpenPitcher | undefined
        const aPct = fipBarPct(a?.fipMinus ?? null)
        const hPct = fipBarPct(h?.fipMinus ?? null)
        const aFip = a?.fipMinus != null ? toFipPlus(a.fipMinus) : null
        const hFip = h?.fipMinus != null ? toFipPlus(h.fipMinus) : null

        return (
          <div key={i} className={styles.compRow}>
            {a ? <PlayerPhoto id={a.id} /> : <div className={styles.photoWrap} />}

            <div className={styles.playerAway}>
              {a ? (
                <>
                  <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(a.name)}</span>
                  <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(a.name)}</span>
                  <span className={styles.meta}>{a.hand} · {a.era ?? '—'} ERA</span>
                </>
              ) : <span className={styles.empty}>—</span>}
            </div>

            <div className={styles.barBlockAway}>
              <div className={styles.barTrack}>
                <div className={styles.barFillRight} style={{ '--bar-width': `${aPct}%`, background: awayColor } as CSSProperties} />
                <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
              </div>
              <span className={styles.fipVal}>
                {aFip ?? '—'}
              </span>
            </div>

            <div className={styles.barBlockHome}>
              <span className={styles.fipVal}>
                {hFip ?? '—'}
              </span>
              <div className={styles.barTrack}>
                <div className={styles.barFillLeft} style={{ '--bar-width': `${hPct}%`, background: homeColor } as CSSProperties} />
                <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
              </div>
            </div>

            <div className={styles.playerHome}>
              {h ? (
                <>
                  <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(h.name)}</span>
                  <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(h.name)}</span>
                  <span className={styles.meta}>{h.hand} · {h.era ?? '—'} ERA</span>
                </>
              ) : <span className={styles.empty}>—</span>}
            </div>

            {h ? <PlayerPhoto id={h.id} /> : <div className={styles.photoWrap} />}
          </div>
        )
      })}

      {/* Team aggregate totals */}
      <div className={styles.totalsRow}>
        <div className={styles.totalsAway}>
          <span className={styles.totalsVal}>{aFipPlus ?? '—'}</span>
          <div className={styles.barTrack}>
            <div className={styles.barFillRight} style={{ '--bar-width': `${aAggPct}%`, background: awayColor } as CSSProperties} />
            <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
          </div>
        </div>
        <div className={styles.totalsHome}>
          <div className={styles.barTrack}>
            <div className={styles.barFillLeft} style={{ '--bar-width': `${hAggPct}%`, background: homeColor } as CSSProperties} />
            <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
          </div>
          <span className={styles.totalsVal}>{hFipPlus ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}

/* ── Single view ─────────────────────────────────────────────── */

function SingleView({ stats, color }: { stats?: BullpenStats; color: string }) {
  if (!stats) return <p className={styles.stateMsg}>—</p>

  return (
    <div>
      <div className={styles.singleHeader}>
        <span />
        <span>Pitcher</span>
        <span>ERA</span>
        <span>IP</span>
        <div className={styles.singleBarWrap}>
          <div style={{ flex: 1 }} />
          <span style={{ minWidth: '26px', textAlign: 'center' }}>FIP+</span>
        </div>
      </div>

      {stats.pitchers.map((p) => {
        const fp  = p.fipMinus != null ? toFipPlus(p.fipMinus) : null
        const pct = fipBarPct(p.fipMinus)
        return (
          <div key={p.id} className={styles.singleRow}>
            <PlayerPhoto id={p.id} />
            <div className={styles.singleInfo}>
              <span className={styles.name}>{fmtName(p.name)}</span>
              <span className={styles.meta}>
                {p.hand}
              </span>
            </div>
            <span className={styles.statVal}>{p.era ?? '—'}</span>
            <span className={styles.statVal}>{p.ip ?? '—'}</span>
            <div className={styles.singleBarWrap}>
              <div className={styles.barTrack}>
                <div className={styles.barFillLeft} style={{ '--bar-width': `${pct}%`, background: color } as CSSProperties} />
                <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
              </div>
              <span className={styles.fipVal}>{fp ?? '—'}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

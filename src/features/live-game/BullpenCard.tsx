import type { BullpenStats, BullpenPitcher, BullpenUsage } from '@/api/mlb/endpoints/bullpenStats'
import type { ViewMode } from './LineupComparison'
import { BarFill, CountUp } from '@/components/AnimatedBar/AnimatedBar'
import CardBgLayers from './CardBgLayers'
import styles from './BullpenCard.module.css'

const FIP_MIN = 70
const FIP_MAX = 130
const AVG_MARK_PCT = ((100 - FIP_MIN) / (FIP_MAX - FIP_MIN)) * 100  // 50%
/** Delay between bullpen rows in the bar cascade, in ms. */
const ROW_STAGGER_MS = 60

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

/* ── Row stat ────────────────────────────────────────────────── */

const fmtWoba = (w: number | null | undefined) => (w != null ? w.toFixed(3).replace(/^0/, '') : '—')

/**
 * ERA, or — with a batter-hand filter, where ERA doesn't exist — wOBA allowed
 * vs that hand plus the sample (batters faced), so small splits read as such.
 */
function rowStat(p: BullpenPitcher, hand: BullpenStats['hand']): string {
  if (hand && hand !== 'all') return `${fmtWoba(p.wobaAgainst)} wOBA · ${p.bf ?? 0} BF`
  return `${p.era ?? '—'} ERA`
}

/* ── Usage strip ─────────────────────────────────────────────── */

type UsageDay = BullpenUsage['days'][number]

function UsageDayBox({ day, pitches, color }: { day: UsageDay; pitches: number; color: string }) {
  const opacity = pitches <= 14 ? 0.35 : pitches <= 24 ? 0.65 : 0.92
  return (
    <div className={styles.usageDay}>
      <div className={styles.usageDot}>
        {pitches > 0 && (
          <div className={styles.usageDotBg} style={{ background: color, opacity }} />
        )}
        {pitches > 0 && (
          <span className={styles.usageDotNum}>{pitches}</span>
        )}
      </div>
      <span className={styles.usageDate}>{day.label}</span>
    </div>
  )
}

function UsageDays({ pitcherId, usage, color }: {
  pitcherId: number
  usage: BullpenUsage
  color: string
}) {
  const counts = usage.pitches[String(pitcherId)] ?? Array(usage.days.length).fill(0)
  return (
    <>
      {usage.days.map((day, i) => (
        <UsageDayBox key={day.gamePk} day={day} pitches={counts[i]} color={color} />
      ))}
    </>
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

  // The pitch-count strip comes with the bullpen data (/api/bullpen).
  const awayUsage = away?.usage
  const homeUsage = home?.usage

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
          {away && home && (
            <div className={styles.viewSizer} aria-hidden="true">
              <ComparisonView
                away={away} home={home}
                awayColor={ac} homeColor={hc}
                awayUsage={awayUsage}
                homeUsage={homeUsage}
              />
            </div>
          )}
          <div className={styles.viewContent}>
            {away && home && mode === 'comparison' && (
              <ComparisonView
                away={away} home={home}
                awayColor={ac} homeColor={hc}
                awayUsage={awayUsage}
                homeUsage={homeUsage}
              />
            )}
            {mode !== 'comparison' && (
              <SingleView
                stats={mode === 'away' ? away : home}
                color={mode === 'away' ? ac : hc}
                usage={mode === 'away' ? awayUsage : homeUsage}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Comparison view ─────────────────────────────────────────── */

function ComparisonView({
  away, home, awayColor, homeColor, awayUsage, homeUsage,
}: {
  away: BullpenStats; home: BullpenStats; awayColor: string; homeColor: string
  awayUsage?: BullpenUsage; homeUsage?: BullpenUsage
}) {
  const rows     = Math.max(away.pitchers.length, home.pitchers.length)
  const aFipPlus = away.teamFipMinus != null ? toFipPlus(away.teamFipMinus) : null
  const hFipPlus = home.teamFipMinus != null ? toFipPlus(home.teamFipMinus) : null
  const aAggPct  = fipBarPct(away.teamFipMinus)
  const hAggPct  = fipBarPct(home.teamFipMinus)
  const showUsage = (awayUsage?.days.length ?? 0) > 0 || (homeUsage?.days.length ?? 0) > 0

  return (
    <div>
      {/* Column header */}
      <div className={styles.compHeader}>
        <span />
        <span />
        <div className={styles.fipHeader}>
          <span className={styles.fip100Away}>100</span>
          <span className={styles.compBarLabel}>FIP+</span>
          <span className={styles.fip100Home}>100</span>
        </div>
        <span />
        <span />
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
          <div key={i} className={styles.compGroup}>
            <div className={styles.compRow}>
              {a ? <PlayerPhoto id={a.id} /> : <div className={styles.photoWrap} />}

              <div className={styles.playerAway}>
                {a ? (
                  <>
                    <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(a.name)}</span>
                    <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(a.name)}</span>
                    <span className={styles.meta}>{a.hand} · {rowStat(a, away.hand)}</span>
                  </>
                ) : <span className={styles.empty}>—</span>}
              </div>

              <div className={styles.barBlockAway}>
                <div className={styles.barTrack}>
                  <BarFill className={styles.barFillRight} width={aPct} color={awayColor} delay={i * ROW_STAGGER_MS} />
                  <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
                </div>
                <span className={styles.fipVal}><CountUp value={aFip} delay={i * ROW_STAGGER_MS} /></span>
              </div>

              <div className={styles.barBlockHome}>
                <span className={styles.fipVal}><CountUp value={hFip} delay={i * ROW_STAGGER_MS} /></span>
                <div className={styles.barTrack}>
                  <BarFill className={styles.barFillLeft} width={hPct} color={homeColor} delay={i * ROW_STAGGER_MS} />
                  <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
                </div>
              </div>

              <div className={styles.playerHome}>
                {h ? (
                  <>
                    <span className={`${styles.name} ${styles.nameDesktop}`}>{fmtName(h.name)}</span>
                    <span className={`${styles.name} ${styles.nameMobile}`}>{lastName(h.name)}</span>
                    <span className={styles.meta}>{h.hand} · {rowStat(h, home.hand)}</span>
                  </>
                ) : <span className={styles.empty}>—</span>}
              </div>

              {h ? <PlayerPhoto id={h.id} /> : <div className={styles.photoWrap} />}
            </div>

            {showUsage && (
              <div className={styles.compUsageRow}>
                <div className={styles.compUsageAway}>
                  {a && awayUsage && awayUsage.days.length > 0 && (
                    <UsageDays pitcherId={a.id} usage={awayUsage} color={awayColor} />
                  )}
                </div>
                <div className={styles.compUsageHome}>
                  {h && homeUsage && homeUsage.days.length > 0 && (
                    <UsageDays pitcherId={h.id} usage={homeUsage} color={homeColor} />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Team aggregate totals */}
      <div className={styles.totalsRow}>
        <div className={styles.totalsAway}>
          <span className={styles.totalsVal}><CountUp value={aFipPlus} delay={rows * ROW_STAGGER_MS} /></span>
          <div className={styles.barTrack}>
            <BarFill className={styles.barFillRight} width={aAggPct} color={awayColor} delay={rows * ROW_STAGGER_MS} />
            <div className={styles.avgMark} style={{ right: `${AVG_MARK_PCT}%` }} />
          </div>
        </div>
        <div className={styles.totalsHome}>
          <div className={styles.barTrack}>
            <BarFill className={styles.barFillLeft} width={hAggPct} color={homeColor} delay={rows * ROW_STAGGER_MS} />
            <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
          </div>
          <span className={styles.totalsVal}><CountUp value={hFipPlus} delay={rows * ROW_STAGGER_MS} /></span>
        </div>
      </div>
    </div>
  )
}

/* ── Single view ─────────────────────────────────────────────── */

function SingleView({ stats, color, usage }: {
  stats?: BullpenStats; color: string; usage?: BullpenUsage
}) {
  if (!stats) return <p className={styles.stateMsg}>—</p>
  const showUsage = (usage?.days.length ?? 0) > 0
  // With a batter-hand filter there's no ERA: wOBA allowed and batters faced instead.
  const byHand = stats.hand != null && stats.hand !== 'all'

  return (
    <div>
      <div className={styles.singleHeader}>
        <span />
        <span>Pitcher</span>
        <span>{byHand ? 'wOBA' : 'ERA'}</span>
        <span>{byHand ? 'BF' : 'IP'}</span>
        <div className={styles.singleBarWrap}>
          <div style={{ flex: 1 }} />
          <span style={{ minWidth: '26px', textAlign: 'center' }}>FIP+</span>
        </div>
      </div>

      {stats.pitchers.map((p, i) => {
        const fp  = p.fipMinus != null ? toFipPlus(p.fipMinus) : null
        const pct = fipBarPct(p.fipMinus)
        return (
          <div key={p.id}>
            <div className={styles.singleRow}>
              <PlayerPhoto id={p.id} />
              <div className={styles.singleInfo}>
                <span className={styles.name}>{fmtName(p.name)}</span>
                <span className={styles.meta}>{p.hand}</span>
              </div>
              <span className={styles.statVal}>{byHand ? fmtWoba(p.wobaAgainst) : p.era ?? '—'}</span>
              <span className={styles.statVal}>{byHand ? p.bf ?? 0 : p.ip ?? '—'}</span>
              <div className={styles.singleBarWrap}>
                <div className={styles.barTrack}>
                  <BarFill className={styles.barFillLeft} width={pct} color={color} delay={i * ROW_STAGGER_MS} />
                  <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
                </div>
                <span className={styles.fipVal}><CountUp value={fp} delay={i * ROW_STAGGER_MS} /></span>
              </div>
            </div>

            {showUsage && usage && (
              <div className={styles.singleUsageRow}>
                <UsageDays pitcherId={p.id} usage={usage} color={color} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

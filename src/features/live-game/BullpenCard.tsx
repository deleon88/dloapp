import type { BullpenStats, BullpenPitcher, BullpenUsage } from '@/api/mlb/endpoints/bullpenStats'
import type { ViewMode } from './LineupComparison'
import { BarFill, CountUp } from '@/components/AnimatedBar/AnimatedBar'
import { capLogoUrl } from '@/data/teams'
import { useT } from '@/i18n/useT'
import CardBgLayers from './CardBgLayers'
import { cutoutUrl } from './mlbImages'
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

/** "Bryan Baker" → ["Bryan", "Baker"] (last name keeps every word after the first). */
function splitName(full: string): [string, string] {
  const [first, ...rest] = full.trim().split(' ')
  return rest.length ? [first, rest.join(' ')] : ['', first]
}

/** MLB cutout of the pitcher, faded at the bottom (TV style). */
function Cutout({ id }: { id?: number }) {
  return (
    <span className={styles.photoBox}>
      {id != null && (
        <img className={styles.photo} src={cutoutUrl(id, 96)} alt="" loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
      )}
    </span>
  )
}

/** First name (small) + LAST NAME in caps, with the throwing-hand chip. */
function TvName({ p }: { p: BullpenPitcher }) {
  const [first, last] = splitName(p.name)
  return (
    <div className={styles.nameLine}>
      <span className={styles.fullName} title={p.name}>
        {first && <span className={styles.first}>{first}</span>}
        <span className={styles.last}>{last}</span>
      </span>
      {p.hand && <span className={styles.hand} aria-label={p.hand === 'L' ? 'LHP' : 'RHP'}>{p.hand}</span>}
    </div>
  )
}

const fmtWoba = (w: number | null | undefined) => (w != null ? w.toFixed(3).replace(/^0/, '') : '—')

const byHand = (hand: BullpenStats['hand']) => hand != null && hand !== 'all'

/**
 * ERA, or — with a batter-hand filter, where ERA doesn't exist — wOBA allowed
 * vs that hand plus the sample (batters faced), so small splits read as such.
 */
function RowStat({ p, hand }: { p: BullpenPitcher; hand: BullpenStats['hand'] }) {
  return byHand(hand)
    ? <span className={styles.rowStat}>{fmtWoba(p.wobaAgainst)} <small>wOBA</small> · {p.bf ?? 0} <small>BF</small></span>
    : <span className={styles.rowStat}>{p.era ?? '—'} <small>ERA</small></span>
}

/* ── Usage strip ─────────────────────────────────────────────── */

type UsageDay = BullpenUsage['days'][number]

/** Pitches thrown that day: team-color box (brighter = more pitches), "—" if he rested, OFF if the team didn't play. */
function UsageBox({ day, pitches, color }: { day: UsageDay; pitches: number; color: string }) {
  if (day.games === 0) return <span className={`${styles.uBox} ${styles.uOff}`}>OFF</span>
  if (!pitches) return <span className={`${styles.uBox} ${styles.uRest}`}>—</span>
  const strength = pitches <= 14 ? 40 : pitches <= 24 ? 65 : 92
  return (
    <span className={styles.uBox} style={{ background: `color-mix(in srgb, ${color} ${strength}%, transparent)` }}>
      {pitches}
    </span>
  )
}

function UsageStrip({ pitcherId, usage, color }: { pitcherId: number; usage: BullpenUsage; color: string }) {
  const counts = usage.pitches[String(pitcherId)] ?? []
  return (
    <div className={styles.uStrip}>
      {usage.days.map((day, i) => <UsageBox key={day.date} day={day} pitches={counts[i] ?? 0} color={color} />)}
    </div>
  )
}

/** The strip's dates, shown once above the rows. */
function UsageDates({ usage }: { usage?: BullpenUsage }) {
  return (
    <div className={styles.uStrip}>
      {usage?.days.map(day => <span key={day.date} className={styles.uDate}>{day.label}</span>)}
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
  /** For the cap logo on the selected team in the selector. */
  awayTeamId?: number
  homeTeamId?: number
  isLoading?: boolean
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
}

export default function BullpenCard({
  away, home,
  awayColor, homeColor,
  awayBarColor, homeBarColor,
  awayLabel, homeLabel,
  awayTeamId, homeTeamId,
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

  // Selector: the cap logo only on the selected team, its name otherwise.
  const teamSegment = (side: 'away' | 'home', label: string, teamId?: number) => (
    <button
      className={`${styles.segment} ${mode === side ? styles.segmentActive : ''}`}
      onClick={() => onModeChange(side)}
      aria-label={label}
    >{mode === side && teamId ? <img className={styles.segmentLogo} src={capLogoUrl(teamId)} alt="" /> : label}</button>
  )

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
        {teamSegment('away', awayLabel, awayTeamId)}
        <button
          className={`${styles.segment} ${mode === 'comparison' ? styles.segmentActive : ''}`}
          onClick={() => onModeChange('comparison')}
        >Bullpen</button>
        {teamSegment('home', homeLabel, homeTeamId)}
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

/** One reliever, TV style: cutout on the outer edge, name, stat and the bar growing toward the middle. */
function Reliever({ side, p, hand, pct, color, delay }: {
  side: 'away' | 'home'; p?: BullpenPitcher; hand: BullpenStats['hand']; pct: number; color: string; delay: number
}) {
  const home = side === 'home'
  const [first, last] = p ? splitName(p.name) : ['', '']
  return (
    <div className={`${styles.side} ${home ? styles.sideHome : ''}`}>
      {!home && <Cutout id={p?.id} />}
      <div className={styles.who}>
        {p ? <>
          <div className={styles.topLine}>
            <span className={styles.first}>{first}</span>
            <RowStat p={p} hand={hand} />
          </div>
          <div className={styles.nameLine} title={p.name}>
            <span className={styles.last}>{last}</span>
            {p.hand && <span className={styles.hand} aria-label={p.hand === 'L' ? 'LHP' : 'RHP'}>{p.hand}</span>}
          </div>
          {/* FIP+ bar: grows toward the FIP+ value in the middle */}
          <div className={`${styles.barTrack} ${styles.fipBar}`}>
            <BarFill className={home ? styles.barFillLeft : styles.barFillRight} width={pct} color={color} delay={delay} />
            <div className={styles.avgMark} style={home ? { left: `${AVG_MARK_PCT}%` } : { right: `${AVG_MARK_PCT}%` }} />
          </div>
        </> : <span className={styles.empty}>—</span>}
      </div>
      {home && <Cutout id={p?.id} />}
    </div>
  )
}

function ComparisonView({
  away, home, awayColor, homeColor, awayUsage, homeUsage,
}: {
  away: BullpenStats; home: BullpenStats; awayColor: string; homeColor: string
  awayUsage?: BullpenUsage; homeUsage?: BullpenUsage
}) {
  const rows     = Math.max(away.pitchers.length, home.pitchers.length)
  const aFipPlus = away.teamFipMinus != null ? toFipPlus(away.teamFipMinus) : null
  const hFipPlus = home.teamFipMinus != null ? toFipPlus(home.teamFipMinus) : null
  const showUsage = (awayUsage?.days.length ?? 0) > 0 || (homeUsage?.days.length ?? 0) > 0
  const totalsDelay = rows * ROW_STAGGER_MS

  return (
    <div>
      {/* Strip dates on each half, "FIP+" in the middle like the lineup's "wRC+" */}
      <div className={`${styles.usageRow} ${styles.uHead}`}>
        {showUsage ? <UsageDates usage={awayUsage ?? homeUsage} /> : <span />}
        <span className={styles.colLabel}>FIP+</span>
        {showUsage ? <UsageDates usage={homeUsage ?? awayUsage} /> : <span />}
      </div>

      {/* away reliever · away FIP+ · · home FIP+ · home reliever — the compared numbers sit together */}
      {Array.from({ length: rows }).map((_, i) => {
        const a = away.pitchers[i] as BullpenPitcher | undefined
        const h = home.pitchers[i] as BullpenPitcher | undefined
        const aFip = a?.fipMinus != null ? toFipPlus(a.fipMinus) : null
        const hFip = h?.fipMinus != null ? toFipPlus(h.fipMinus) : null
        const delay = i * ROW_STAGGER_MS
        return (
          <div key={i} className={styles.group}>
            <div className={styles.row}>
              <Reliever side="away" p={a} hand={away.hand} pct={fipBarPct(a?.fipMinus ?? null)} color={awayColor} delay={delay} />
              <span className={`${styles.val} ${styles.valAway}`}>{a && <CountUp value={aFip} delay={delay} />}</span>
              <span />
              <span className={`${styles.val} ${styles.valHome}`}>{h && <CountUp value={hFip} delay={delay} />}</span>
              <Reliever side="home" p={h} hand={home.hand} pct={fipBarPct(h?.fipMinus ?? null)} color={homeColor} delay={delay} />
            </div>

            {showUsage && (
              <div className={styles.usageRow}>
                {a && awayUsage?.days.length ? <UsageStrip pitcherId={a.id} usage={awayUsage} color={awayColor} /> : <span />}
                <span />
                {h && homeUsage?.days.length ? <UsageStrip pitcherId={h.id} usage={homeUsage} color={homeColor} /> : <span />}
              </div>
            )}
          </div>
        )
      })}

      {/* Team totals: bullpen FIP+ on the same columns, thicker bars */}
      <div className={`${styles.row} ${styles.totals}`}>
        <TotalSide side="away" value={aFipPlus} pct={fipBarPct(away.teamFipMinus)} color={awayColor} delay={totalsDelay} />
        <span className={`${styles.totalVal} ${styles.valAway}`}><CountUp value={aFipPlus} delay={totalsDelay} /></span>
        <span />
        <span className={`${styles.totalVal} ${styles.valHome}`}><CountUp value={hFipPlus} delay={totalsDelay} /></span>
        <TotalSide side="home" value={hFipPlus} pct={fipBarPct(home.teamFipMinus)} color={homeColor} delay={totalsDelay} />
      </div>
    </div>
  )
}

function TotalSide({ side, pct, color, delay }: {
  side: 'away' | 'home'; value: number | null; pct: number; color: string; delay: number
}) {
  const home = side === 'home'
  return (
    <div className={`${styles.side} ${home ? styles.sideHome : ''}`}>
      {!home && <span className={styles.totalLabel}>Bullpen</span>}
      <div className={styles.line}>
        <div className={`${styles.barTrack} ${styles.totalTrack}`}>
          <BarFill className={home ? styles.barFillLeft : styles.barFillRight} width={pct} color={color} delay={delay} />
          <div className={styles.avgMark} style={home ? { left: `${AVG_MARK_PCT}%` } : { right: `${AVG_MARK_PCT}%` }} />
        </div>
      </div>
      {home && <span className={styles.totalLabel}>Bullpen</span>}
    </div>
  )
}

/* ── Single view ─────────────────────────────────────────────── */

function SingleView({ stats, color, usage }: {
  stats?: BullpenStats; color: string; usage?: BullpenUsage
}) {
  const t = useT()
  if (!stats) return <p className={styles.stateMsg}>—</p>
  const showUsage = (usage?.days.length ?? 0) > 0
  // With a batter-hand filter there's no ERA: wOBA allowed and batters faced instead.
  const hand = byHand(stats.hand)

  return (
    <div>
      {/* photo · pitcher · ERA IP (wOBA BF) · FIP+ */}
      <div className={`${styles.sRow} ${styles.sHead}`}>
        <span />
        <span>{t('pitcherWord')}</span>
        <span className={styles.sNum}>{hand ? 'wOBA' : 'ERA'}</span>
        <span className={styles.sNum}>{hand ? 'BF' : 'IP'}</span>
        <span className={styles.sFipHead}>FIP+</span>
      </div>
      {showUsage && <div className={`${styles.sUsageRow} ${styles.uHead}`}><UsageDates usage={usage} /></div>}

      {stats.pitchers.map((p, i) => {
        const fp  = p.fipMinus != null ? toFipPlus(p.fipMinus) : null
        const delay = i * ROW_STAGGER_MS
        return (
          <div key={p.id} className={styles.group}>
            <div className={styles.sRow}>
              <Cutout id={p.id} />
              <div className={styles.who}><TvName p={p} /></div>
              <span className={styles.sNum}>{hand ? fmtWoba(p.wobaAgainst) : p.era ?? '—'}</span>
              <span className={styles.sNum}>{hand ? p.bf ?? 0 : p.ip ?? '—'}</span>
              <div className={styles.sFip}>
                <div className={styles.barTrack}>
                  <BarFill className={styles.barFillLeft} width={fipBarPct(p.fipMinus)} color={color} delay={delay} />
                  <div className={styles.avgMark} style={{ left: `${AVG_MARK_PCT}%` }} />
                </div>
                <span className={styles.sFipVal}><CountUp value={fp} delay={delay} /></span>
              </div>
            </div>

            {showUsage && usage && (
              <div className={styles.sUsageRow}>
                <UsageStrip pitcherId={p.id} usage={usage} color={color} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

import { forwardRef, type CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import type { ScheduledGame } from '@/api/mlb/types'
import type { PitcherInfo } from '@/api/mlb/endpoints/pitcherStats'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import type { PlayerStats } from '@/api/mlb/endpoints/lineupStats'
import type { BullpenStats } from '@/api/mlb/endpoints/bullpenStats'
import type { GameResult } from '@/api/mlb/endpoints/teamRecentResults'
import { capLogoUrl, getBarColor, getTeamMeta } from '@/data/teams'
import { useLangStore } from '@/stores/langStore'
import { useT } from '@/i18n/useT'
import { cutoutUrl, teamLogoUrl } from '../mlbImages'
import styles from './ShareCard.module.css'

/** Everything the image shows, as the game page has it (filters already applied). */
export interface ShareData {
  game: ScheduledGame
  awayPitcher?: PitcherInfo
  homePitcher?: PitcherInfo
  awayOpener?: boolean
  homeOpener?: boolean
  awayLineup: LineupSlot[]
  homeLineup: LineupSlot[]
  wrcMap?: Map<number, PlayerStats>
  awayStatus?: 'confirmed' | 'projected'
  homeStatus?: 'confirmed' | 'projected'
  awayBullpen?: BullpenStats
  homeBullpen?: BullpenStats
  awayLast5?: GameResult[]
  homeLast5?: GameResult[]
  /** The filters the numbers follow, ready to print ("2026 Season · Batters vs starter hand…"). */
  filters: string
}

const splitName = (full: string): [string, string] => {
  const [first, ...rest] = full.trim().split(' ')
  return rest.length ? [first, rest.join(' ')] : ['', first]
}
const lastName = (full: string) => splitName(full)[1]
const fmt2 = (v?: number | null) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2))

/** PA-weighted wRC+ of a lineup (same as the lineup card). */
function lineupWrc(lineup: LineupSlot[], wrc?: Map<number, PlayerStats>): number | null {
  let sum = 0, pa = 0
  for (const p of lineup) {
    const s = wrc?.get(p.id)
    if (s?.wRcPlus == null) continue
    const w = s.pa ?? p.pa ?? 1
    sum += s.wRcPlus * w
    pa += w
  }
  return pa ? Math.round(sum / pa) : null
}

function kbbPct(p?: PitcherInfo): number | null {
  const s = p?.seasonStats
  return s && s.battersFaced ? ((s.strikeOuts - s.baseOnBalls) / s.battersFaced) * 100 : null
}

/** Value · bar toward the middle · label · bar · value, the better one bright. */
function Compare({ label, a, h, max, low, show, ac, hc }: {
  label: string; a: number | null; h: number | null; max: number; low?: boolean
  show: (v: number | null) => string; ac: string; hc: string
}) {
  const width = (v: number | null) => (v == null ? 0 : Math.max(2, Math.min(100, ((low ? max - v : v) / max) * 100)))
  const aBetter = a != null && h != null && (low ? a < h : a > h)
  const hBetter = a != null && h != null && (low ? h < a : h > a)
  return (
    <div className={styles.cmp}>
      <span className={`${styles.cmpVal} ${hBetter ? styles.dim : ''}`}>{show(a)}</span>
      <span className={`${styles.track} ${styles.trackAway}`}><i style={{ width: `${width(a)}%`, background: ac }} /></span>
      <span className={styles.lbl}>{label}</span>
      <span className={styles.track}><i style={{ width: `${width(h)}%`, background: hc }} /></span>
      <span className={`${styles.cmpVal} ${styles.right} ${aBetter ? styles.dim : ''}`}>{show(h)}</span>
    </div>
  )
}

function Dots({ results, color, right }: { results?: GameResult[]; color: string; right?: boolean }) {
  if (!results?.length) return null
  return (
    <span className={`${styles.dots} ${right ? styles.dotsRight : ''}`}>
      {results.map((r, i) => <i key={i} style={{ background: r === 'W' ? color : 'rgba(255,255,255,0.14)' }}>{r}</i>)}
    </span>
  )
}

function Pitcher({ p, opener, projected, side, teamId }: { p?: PitcherInfo; opener?: boolean; projected?: boolean; side: 'away' | 'home'; teamId: number }) {
  const t = useT()
  // The team's primary logo, faint, behind the starter (as on the pitcher card), kept inside its half
  const logo = <img className={styles.pitcherLogo} src={teamLogoUrl(teamId)} alt="" crossOrigin="anonymous" />
  if (!p) return <div className={`${styles.pitcher} ${side === 'home' ? styles.pitcherHome : ''}`}>{logo}<span className={styles.tbd}>TBD</span></div>
  const [first, last] = splitName(p.fullName)
  const s = p.seasonStats
  const line = s ? [`${s.wins}-${s.losses}`, s.era && !s.vsHand ? `${s.era} ERA` : null, s.inningsPitched ? `${s.inningsPitched} IP` : null].filter(Boolean).join(' · ') : ''
  return (
    <div className={`${styles.pitcher} ${side === 'home' ? styles.pitcherHome : ''}`}>
      {logo}
      <img className={styles.pitcherPhoto} src={cutoutUrl(p.id, 240)} alt="" crossOrigin="anonymous" />
      <div className={styles.pitcherText}>
        <div className={styles.first}>{first}{projected && <span className={styles.projMark}>{first ? ' · ' : ''}{t('projectedShort')}</span>}</div>
        <div className={styles.last}>{last}</div>
        <div className={styles.pitcherLine}>{line}</div>
        <div className={styles.chips}>
          {p.pitchHand && <span className={styles.chip}>{p.pitchHand}HP</span>}
          {opener && <span className={styles.chip}>{t('opener')}</span>}
        </div>
      </div>
    </div>
  )
}

/** A batter: LAST NAME + position, over a thin wRC+ bar (0–200, mark at 100) toward the middle. */
function Batter({ slot, wrc, color, home }: { slot?: LineupSlot; wrc: number | null; color: string; home?: boolean }) {
  if (!slot) return <span />
  const pos = <span className={styles.pos}>{slot.pos}</span>
  return (
    <span className={`${styles.batter} ${home ? styles.right : ''}`}>
      <span className={styles.batterName}>{home ? <>{pos} {lastName(slot.fullName)}</> : <>{lastName(slot.fullName)} {pos}</>}</span>
      <span className={`${styles.mini} ${home ? styles.miniHome : ''}`}>
        <i style={{ width: `${wrc == null ? 0 : Math.min(100, wrc / 2)}%`, background: color }} />
        <b />
      </span>
    </span>
  )
}

/** A reliever: cutout, LAST NAME, hand, FIP+ and pitches the last 3 days. */
function Arm({ bp, i, color, home }: { bp?: BullpenStats; i: number; color: string; home?: boolean }) {
  const p = bp?.pitchers[i]
  if (!p) return <div />
  const counts = bp?.usage?.pitches[String(p.id)]?.slice(-3)
  const days = bp?.usage?.days.slice(-3)
  const usage = counts?.map((n, k) => (days?.[k]?.games === 0 ? 'OFF' : n ? String(n) : '–')).join(' · ')
  return (
    <div className={`${styles.arm} ${home ? styles.armHome : ''}`}>
      <img className={styles.armPhoto} src={cutoutUrl(p.id, 60)} alt="" crossOrigin="anonymous" />
      <span className={styles.armText}>
        <span className={styles.armName}>
          {lastName(p.name)} {p.hand && <span className={styles.chipSm}>{p.hand}</span>}{' '}
          <span className={styles.armVal} style={{ color }}>{p.fipMinus != null ? Math.round(200 - p.fipMinus) : '—'}</span>
        </span>
        {usage && <span className={styles.armUsage}>3D {usage}</span>}
      </span>
    </div>
  )
}

/**
 * The shareable image (360 × 640, exported at 3×): the starters' duel, four
 * comparisons, both lineups with wRC+ bars, lineup and bullpen totals with the
 * top three relievers, and the filters the numbers follow.
 */
const ShareCard = forwardRef<HTMLDivElement, { data: ShareData }>(function ShareCard({ data }, ref) {
  const t = useT()
  const { game } = data
  const am = getTeamMeta(game.teams.away.team.id)
  const hm = getTeamMeta(game.teams.home.team.id)
  const ac = am ? getBarColor(am) : '#8fbce6'
  const hc = hm ? getBarColor(hm) : '#e31937'
  const awayBg = am?.color ?? '#0b1a33'
  const homeBg = hm?.color ?? '#0b1a33'
  const ap = data.awayPitcher?.seasonStats
  const hp = data.homePitcher?.seasonStats
  const wrc = (s?: LineupSlot) => (s ? data.wrcMap?.get(s.id)?.wRcPlus ?? null : null)
  const date = parseISO(game.gameDate)
  const lang = useLangStore(s => s.lang)
  // "DOM 18 OCT" / "SUN, OCT 18" in the app's language
  const day = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(date).replace(/\./g, '').toUpperCase()
  const bpPlus = (b?: BullpenStats) => (b?.teamFipMinus != null ? Math.round(200 - b.teamFipMinus) : null)
  const status = (s?: 'confirmed' | 'projected') => (s === 'confirmed' ? t('confirmed') : s === 'projected' ? t('projected') : '')
  const int = (v: number | null) => (v == null ? '—' : String(v))

  return (
    <div ref={ref} className={styles.card} style={{ '--away': awayBg, '--home': homeBg } as CSSProperties}>
      <div className={styles.meta}>
        <b>Dloapp</b>
        <span>{day} · {game.venue?.name?.toUpperCase()}</span>
      </div>

      <div className={styles.teams}>
        <div className={styles.team}>
          <img src={capLogoUrl(game.teams.away.team.id)} alt="" crossOrigin="anonymous" />
          <div><div className={styles.teamName}>{am?.brief ?? game.teams.away.team.name}</div><Dots results={data.awayLast5} color={ac} /></div>
        </div>
        <div className={styles.time}>{format(date, 'h:mm a')}</div>
        <div className={`${styles.team} ${styles.teamHome}`}>
          <div><div className={styles.teamName}>{hm?.brief ?? game.teams.home.team.name}</div><Dots results={data.homeLast5} color={hc} right /></div>
          <img src={capLogoUrl(game.teams.home.team.id)} alt="" crossOrigin="anonymous" />
        </div>
      </div>

      <div className={styles.duel}>
        <Pitcher p={data.awayPitcher} opener={data.awayOpener} side="away" teamId={game.teams.away.team.id}
          projected={(game.teams.away as { probablePitcher?: { projected?: boolean } }).probablePitcher?.projected} />
        <Pitcher p={data.homePitcher} opener={data.homeOpener} side="home" teamId={game.teams.home.team.id}
          projected={(game.teams.home as { probablePitcher?: { projected?: boolean } }).probablePitcher?.projected} />
      </div>

      <Compare label="FIP" a={ap?.fip ?? null} h={hp?.fip ?? null} max={6} low show={fmt2} ac={ac} hc={hc} />
      <Compare label="xFIP" a={ap?.xfip ?? null} h={hp?.xfip ?? null} max={6} low show={fmt2} ac={ac} hc={hc} />
      <Compare label="K-BB%" a={kbbPct(data.awayPitcher)} h={kbbPct(data.homePitcher)} max={30}
        show={v => (v == null ? '—' : `${v.toFixed(1)}%`)} ac={ac} hc={hc} />
      <Compare label="WHIP" a={ap?.whip ? Number(ap.whip) : null} h={hp?.whip ? Number(hp.whip) : null} max={2} low show={fmt2} ac={ac} hc={hc} />

      <div className={styles.section}>
        <span>{status(data.awayStatus)}</span><b>LINEUP · wRC+</b><span>{status(data.homeStatus)}</span>
      </div>
      {Array.from({ length: 9 }, (_, i) => {
        const a = data.awayLineup[i], h = data.homeLineup[i]
        return (
          <div key={i} className={styles.lineupRow}>
            <Batter slot={a} wrc={wrc(a)} color={ac} />
            <span className={styles.lineupVal}>{a ? int(wrc(a)) : ''}</span>
            <span className={styles.slot}>{i + 1}</span>
            <span className={`${styles.lineupVal} ${styles.left}`}>{h ? int(wrc(h)) : ''}</span>
            <Batter slot={h} wrc={wrc(h)} color={hc} home />
          </div>
        )
      })}

      <div className={styles.totals}>
        <Compare label="LINEUP" a={lineupWrc(data.awayLineup, data.wrcMap)} h={lineupWrc(data.homeLineup, data.wrcMap)} max={200} show={int} ac={ac} hc={hc} />
        <Compare label="BULLPEN FIP+" a={bpPlus(data.awayBullpen)} h={bpPlus(data.homeBullpen)} max={200} show={int} ac={ac} hc={hc} />
      </div>
      <div className={styles.arms}>
        <div>{[0, 1, 2].map(i => <Arm key={i} bp={data.awayBullpen} i={i} color={ac} />)}</div>
        <div>{[0, 1, 2].map(i => <Arm key={i} bp={data.homeBullpen} i={i} color={hc} home />)}</div>
      </div>

      <div className={styles.foot}>
        <span>{data.filters}</span>
        <b>dloapp.vercel.app</b>
      </div>
    </div>
  )
})

export default ShareCard

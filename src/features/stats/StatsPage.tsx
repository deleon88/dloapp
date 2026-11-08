import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchLeaders, type BatterRow, type LeaderHand, type LeaderRole, type LeadersResponse, type PitcherRow, type TeamRow,
} from '@/api/leaders'
import { CountUp } from '@/components/AnimatedBar/AnimatedBar'
import { capLogoUrl, getBarColor, getLeagueClubs, getTeamMeta, teamLeague } from '@/data/teams'
import { leagueSeason } from '@/data/leagues'
import { useLeague } from '@/utils/useLeague'
import { mlbToday } from '@/utils/etDate'
import { useT } from '@/i18n/useT'
import { PERIOD_OPTIONS, type StatPeriod } from '@/utils/period'
import { cutoutUrl } from '@/features/live-game/mlbImages'
import {
  CATALOG, columnsFor, DEFAULT_SORT, DEFAULT_STATS, formatStat, type AnyRow, type Column, type Section,
} from './columns'
import { fetchTodaysStarters } from './todaysStarters'
import styles from './StatsPage.module.css'

/** Rows rendered before "Show more" (images are the heavy part). */
const PAGE = 60

const BAT_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] as const
const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF'])

type Min = 'q' | 'all' | number
const MIN_PA = [50, 100, 200, 300]
const MIN_IP = [10, 20, 50, 100]

const isTeamRow = (r: AnyRow): r is TeamRow => 'bat' in r

/** A batter at a position (OF = any outfield spot; Ohtani's TWP counts as DH). */
function matchesPos(b: BatterRow, pos: string): boolean {
  const p = b.pos === 'TWP' ? 'DH' : b.pos
  return pos === 'OF' ? OUTFIELD.has(p) : p === pos
}

interface BarScale { lo: number; mid: number; hi: number }

/** Position (0–100) of a value on the scale; reversed for lower-is-better stats. */
function onScale(v: number, s: BarScale, low?: boolean): number {
  if (s.hi === s.lo) return 50
  const p = ((v - s.lo) / (s.hi - s.lo)) * 100
  return Math.max(0, Math.min(100, low ? 100 - p : p))
}

/** Percentile (0–100, higher = better) of `v` among `vals` (ascending). */
function percentile(vals: number[], v: number, low?: boolean): number {
  let below = 0, equal = 0
  for (const x of vals) { if (x < v) below++; else if (x === v) equal++ }
  const p = vals.length > 1 ? ((below + (equal - 1) / 2) / (vals.length - 1)) * 100 : 50
  return low ? 100 - p : p
}

// ── Chosen stats per section, kept on this device ─────────────────────
const STORE_KEY = 'dlo.stats.cols.v1'

function loadStats(): Record<Section, string[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Record<Section, string[]>> | null
    return {
      bat: saved?.bat?.length ? saved.bat : DEFAULT_STATS.bat,
      pit: saved?.pit?.length ? saved.pit : DEFAULT_STATS.pit,
      team: saved?.team?.length ? saved.team : DEFAULT_STATS.team,
    }
  } catch {
    return { ...DEFAULT_STATS }
  }
}

function saveStats(v: Record<Section, string[]>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)) } catch { /* private mode: keep it in memory */ }
}

export default function StatsPage() {
  const t = useT()
  // The page's league (/lidom/stats). Switching leagues remounts the page (see LeagueScope).
  const { key: leagueKey, name: leagueName, caps } = useLeague()
  const currentSeason = () => leagueSeason(leagueKey, mlbToday())
  const [sec, setSec] = useState<Section>('bat')
  const [season, setSeason] = useState(currentSeason)
  const [period, setPeriod] = useState<StatPeriod>('season')
  const [hand, setHand] = useState<LeaderHand>('all')
  const [role, setRole] = useState<LeaderRole>('all')
  const [min, setMin] = useState<Min>('q')
  /** Only today's starters (probable pitchers / starting nine), on or off. */
  const [startersOnly, setStartersOnly] = useState(false)
  /** Position and team: one chip, combinable (e.g. NYY · SS). '' / 0 = any. AL / NL only where the league has them. */
  const [posF, setPosF] = useState('')
  const [teamF, setTeamF] = useState(0)
  const [league, setLeague] = useState<'all' | 'AL' | 'NL'>('all')
  const [chosen, setChosen] = useState(loadStats)
  const [picking, setPicking] = useState(false)
  const [sort, setSort] = useState({ id: DEFAULT_SORT.bat, asc: false })
  const [open, setOpen] = useState<number | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const pillsRef = useRef<HTMLDivElement>(null)
  const [pillsMore, setPillsMore] = useState(false)

  const cols = useMemo(() => columnsFor(sec, chosen[sec]), [sec, chosen])

  // The pills fade out under the buttons only while there are more to scroll to.
  const checkPills = () => {
    const el = pillsRef.current
    if (el) setPillsMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }
  useEffect(() => {
    checkPills()
    window.addEventListener('resize', checkPills)
    return () => window.removeEventListener('resize', checkPills)
  }, [cols])
  const sortCol = cols.find(c => c.id === sort.id) ?? cols[0]

  // The chosen stat's pill always in sight: scroll the row to it when it's under the
  // buttons or the fade (e.g. wRC+, last of many). Only the row scrolls, never the page.
  useEffect(() => {
    const el = pillsRef.current
    const pill = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!el || !pill) return
    const fade = 24
    const start = pill.offsetLeft - el.offsetLeft, end = start + pill.offsetWidth
    if (end > el.scrollLeft + el.clientWidth - fade) el.scrollTo({ left: end - el.clientWidth + fade, behavior: 'smooth' })
    else if (start < el.scrollLeft) el.scrollTo({ left: start - 8, behavior: 'smooth' })
  }, [sortCol.id, cols])
  const asc = sortCol.id === sort.id ? sort.asc : !!sortCol.low

  const query = useQuery({
    queryKey: ['leaders', leagueKey, sec, season, period, hand, sec === 'bat' ? 'all' : role],
    queryFn: () => fetchLeaders({ league: leagueKey, type: sec, season, period, hand, role }),
    staleTime: 30 * 60_000,
    // Keep the old list while the next one loads, only within the same section.
    placeholderData: prev => (prev?.type === sec ? prev : undefined),
  })
  const data = query.data

  const startersQuery = useQuery({
    queryKey: ['todays-starters', leagueKey],
    queryFn: () => fetchTodaysStarters(leagueKey),
    enabled: startersOnly && sec !== 'team',
    staleTime: 10 * 60_000,
  })
  const starters = startersOnly && sec !== 'team' ? startersQuery.data : undefined

  // The comparison pool: the whole league that meets the minimum sample, whatever the
  // team / position / league / today's-starters filters show. Bars and percentiles
  // measure against it, so a player's numbers don't change with what's on screen.
  const pool = useMemo(() => {
    if (!data) return []
    if (data.type === 'team') return data.teams as AnyRow[]
    const games = data.teamGames
    // With a hand filter, "qualified" scales by the league's share of PAs vs that hand.
    const share = data.qualShare
    return (data.players as (BatterRow | PitcherRow)[]).filter(r => {
      if ('pa' in r) {
        if (min === 'q') return r.pa >= 3.1 * share * (games[r.team] ?? 0)
        if (typeof min === 'number') return r.pa >= min
      } else {
        // Relievers don't reach 1 IP per team game: a third of it.
        if (min === 'q') return r.ip >= (role === 'rp' ? 1 / 3 : 1) * share * (games[r.team] ?? 0)
        if (typeof min === 'number') return r.ip >= min
      }
      return true
    }) as AnyRow[]
  }, [data, min, role])

  // What's shown: the pool narrowed by team / position / league, or today's starters
  // whatever their sample. Sorted, nulls always last.
  const rows = useMemo(() => {
    if (!data) return []
    const list: AnyRow[] = starters ? (data.type === 'team' ? data.teams : data.players) : pool
    const filtered = list.filter(r => {
      const team = isTeamRow(r) ? r.id : r.team
      if (teamF && team !== teamF) return false
      if (league !== 'all') {
        const meta = getTeamMeta(team)
        if (!meta || teamLeague(meta) !== league) return false
      }
      if (starters && !(data.type === 'bat' ? starters.batters : starters.pitchers).has((r as BatterRow | PitcherRow).id)) return false
      return data.type !== 'bat' || !posF || matchesPos(r as BatterRow, posF)
    })
    const dir = asc ? 1 : -1
    return filtered.sort((a, b) => {
      const x = sortCol.get(a), y = sortCol.get(b)
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      return (x - y) * dir
    })
  }, [data, pool, posF, teamF, league, sortCol, asc, starters])

  // The bar scale of the sort stat: its fixed one (wRC+ 0–100–200), else the league pool's
  // (lowest – median – highest). Lower-is-better stats run the other way: longer = better.
  const scale = useMemo<BarScale>(() => {
    if (sortCol.scale) return { lo: sortCol.scale[0], mid: sortCol.scale[1], hi: sortCol.scale[2] }
    const vals = pool.map(sortCol.get).filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
    if (!vals.length) return { lo: 0, mid: 0, hi: 0 }
    return { lo: vals[0], mid: vals[Math.floor(vals.length / 2)], hi: vals[vals.length - 1] }
  }, [pool, sortCol])

  function changeSection(s: Section) {
    setSec(s)
    const first = columnsFor(s, chosen[s]).find(c => c.id === DEFAULT_SORT[s]) ?? columnsFor(s, chosen[s])[0]
    setSort({ id: first.id, asc: !!first.low })
    setOpen(null); setLimit(PAGE); setPosF(''); setTeamF(0); setMin('q'); setRole('all')
  }
  function sortBy(col: Column) {
    setSort(col.id === sortCol.id ? { id: col.id, asc: !asc } : { id: col.id, asc: !!col.low })
    setLimit(PAGE)
    // Runs, steals, ERA… have no hand split: sorting by one clears the hand filter.
    if (col.noHand) setHand('all')
  }
  function pickStats(ids: string[]) {
    const next = { ...chosen, [sec]: ids }
    setChosen(next)
    saveStats(next)
  }

  const secIdx = ['bat', 'pit', 'team'].indexOf(sec)
  // Teams: the hand is the pitchers' for their batting and the batters' for their pitching.
  const handLabels = sec === 'pit' ? [t('statsVsLhb'), t('statsVsRhb')]
    : sec === 'team' ? [t('statsVsLefties'), t('statsVsRighties')]
    : [t('statsVsLhp'), t('statsVsRhp')]
  const clubs = useMemo(() => getLeagueClubs(leagueKey).sort((a, b) => a.abbr.localeCompare(b.abbr)), [leagueKey])
  // "MLB · All pos" by default; "NYY · SS", "AL · SS"… (batters always show the position part)
  const scopeLabel = [
    teamF ? getTeamMeta(teamF)?.abbr : league !== 'all' ? league : leagueName,
    posF || (sec === 'bat' ? t('allPos') : ''),
  ].filter(Boolean).join(' · ')
  const notes = noteFor(data, sec, hand, role, period, t)
  // "Percentile vs the whole league · Qualified" (teams: all 30, no minimum)
  const poolSample = sec === 'team' ? ''
    : min === 'q' ? t('minQualified') : min === 'all' ? t('minAll') : `≥ ${min} ${sec === 'bat' ? 'PA' : 'IP'}`
  const poolNote = [t('percentileNote'), poolSample].filter(Boolean).join(' · ')

  return (
    <div className={styles.page}>
      <div className={styles.seg}>
        <div className={styles.segPill} style={{ transform: `translateX(${secIdx * 100}%)` }} />
        {(['bat', 'pit', 'team'] as const).map(s => (
          <button key={s} className={`${styles.segBtn} ${s === sec ? styles.segOn : ''}`} onClick={() => changeSection(s)}>
            {t(s === 'bat' ? 'statsBatters' : s === 'pit' ? 'statsPitchers' : 'statsTeams')}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        {sec !== 'team' && (
          <button className={`${styles.chip} ${styles.toggle} ${startersOnly ? styles.toggleOn : ''}`}
            aria-pressed={startersOnly} onClick={() => { setStartersOnly(on => !on); setLimit(PAGE) }}>
            <span className={styles.toggleDot} aria-hidden="true" />
            {t('todaysStarters')}
          </button>
        )}
        {/* Date range: this season, last season, or a recent window of this season */}
        <Dropdown
          value={season !== currentSeason() ? 'last' : period === 'season' ? 'this' : period}
          set={season !== currentSeason() || period !== 'season'}
          onChange={v => {
            if (v === 'this' || v === 'last') {
              setSeason(v === 'this' ? currentSeason() : currentSeason() - 1)
              setPeriod('season')
            } else {
              setSeason(currentSeason())
              setPeriod(v as StatPeriod)
            }
          }}
          sections={[
            { options: [
              ['this', t('seasonYear').replace('{year}', String(currentSeason()))],
              ['last', t('seasonYear').replace('{year}', String(currentSeason() - 1))],
            ] },
            { options: PERIOD_OPTIONS.filter(o => o.value !== 'season').map(o => [o.value, t(o.value)]) },
          ]} />
        <Dropdown value={hand} set={hand !== 'all'} onChange={v => setHand(v as LeaderHand)}
          locked={sortCol.noHand} lockedTitle={t('handLocked').replace('{stat}', sortCol.label)}
          sections={[{ options: [['all', t('statsVsAll')], ['L', handLabels[0]], ['R', handLabels[1]]] }]} />
        {sec !== 'bat' && (
          <Dropdown value={role} set={role !== 'all'} onChange={v => setRole(v as LeaderRole)}
            sections={[{ options: [['all', t('roleAll')], ['sp', t('roleSp')], ['rp', t('roleRp')]] }]} />
        )}
        {sec !== 'team' && (
          <Dropdown value={String(min)} set={min !== 'q'} onChange={v => setMin(v === 'q' || v === 'all' ? v : Number(v))}
            sections={[{ options: [['q', t('minQualified')], ['all', t('minAll')],
              ...(sec === 'bat' ? MIN_PA.map(n => [String(n), `≥ ${n} PA`]) : MIN_IP.map(n => [String(n), `≥ ${n} IP`]))] as [string, string][] }]} />
        )}
        {sec !== 'team' ? (
          // Position, league and team in one chip: positions on top, then MLB and an AL / NL
          // block each (the block's title picks the league, its teams pick one team). A
          // position combines with a league or a team; tapping a chosen one again clears it.
          <Dropdown value="" set={!!posF || !!teamF || league !== 'all'} label={scopeLabel} keepOpen
            isSelected={v => v === `p:${posF}` || v === `t:${teamF}` || (v === `L:${league}` && !teamF)}
            onChange={v => {
              // a chosen position again (or "All positions") clears it
              if (v.startsWith('p:')) return setPosF(p => (p === v.slice(2) ? '' : v.slice(2)))
              if (v.startsWith('t:')) {
                const id = Number(v.slice(2))
                setTeamF(x => (x === id ? 0 : id))
                setLeague('all')
                return
              }
              setLeague(v.slice(2) as 'all' | 'AL' | 'NL')
              setTeamF(0)
            }}
            sections={[
              ...(sec === 'bat' ? [{
                title: t('positionsLabel'), header: ['p:', t('allPos')] as [string, string], grid: 5,
                options: BAT_POSITIONS.map(p => [`p:${p}`, p] as [string, string]),
              }] : []),
              { options: [['L:all', leagueName]], full: true },
              ...(caps.subLeagues
                ? (['AL', 'NL'] as const).map(lg => ({
                    header: [`L:${lg}`, lg] as [string, string], grid: 3,
                    options: clubs.filter(c => teamLeague(c) === lg).map(c => [`t:${c.id}`, c.abbr] as [string, string]),
                  }))
                : [{ grid: 3, options: clubs.map(c => [`t:${c.id}`, c.abbr] as [string, string]) }]),
            ]} />
        ) : caps.subLeagues && (
          <Dropdown value={league} set={league !== 'all'} onChange={v => setLeague(v as 'all' | 'AL' | 'NL')}
            sections={[{ options: [['all', leagueName], ['AL', 'AL'], ['NL', 'NL']] }]} />
        )}
      </div>

      {/* Sort: tap a stat (again to flip), the arrow flips too; Stats picks which ones show */}
      <div className={styles.toolbar}>
        <div ref={pillsRef} className={`${styles.pills} ${pillsMore ? styles.pillsFade : ''}`} onScroll={checkPills}>
          {cols.map(c => (
            <button key={c.id} className={`${styles.pill} ${c.id === sortCol.id ? styles.pillOn : ''}`} aria-pressed={c.id === sortCol.id} onClick={() => sortBy(c)}>{c.label}</button>
          ))}
        </div>
        <button className={styles.dirBtn} onClick={() => setSort({ id: sortCol.id, asc: !asc })}
          aria-label={asc ? '↑' : '↓'}>{asc ? '↑' : '↓'}</button>
        <button className={styles.pickBtn} onClick={() => setPicking(true)} aria-label={t('statsPickTitle')}>
          <SlidersIcon /> {t('statsPick')}
        </button>
      </div>

      <div className={`${styles.list} ${query.isFetching && data ? styles.listLoading : ''}`}>
        <div className={styles.listHead}>
          <span>#</span>
          <span>{sec === 'team' ? t('statsTeam') : t('statsPlayer')}</span>
          <span className={styles.listHeadVal}>{sortCol.label}</span>
        </div>

        {query.isLoading && <p className={styles.state}>…</p>}
        {query.isError && !data && <p className={styles.state}>{t('statsLoadError')}</p>}
        {data && rows.length === 0 && <p className={styles.state}>{t('statsEmpty')}</p>}

        {rows.slice(0, limit).map((r, i) => (
          <StatRow key={r.id} row={r} subLeagues={caps.subLeagues} order={i % PAGE} rank={asc === !!sortCol.low ? i + 1 : rows.length - i} sortCol={sortCol} scale={scale} cols={cols} pool={pool} poolNote={poolNote}
            open={open === r.id} onToggle={() => setOpen(o => (o === r.id ? null : r.id))} />
        ))}

        {rows.length > limit && (
          <button className={styles.more} onClick={() => setLimit(l => l + PAGE)}>
            {t('showMore')} · {rows.length - limit}
          </button>
        )}
      </div>

      {notes.length > 0 && <div className={styles.notes}>{notes.map(n => <p key={n}>{n}</p>)}</div>}

      {picking && (
        <StatPicker sec={sec} chosen={chosen[sec]} onChange={pickStats}
          onReset={() => pickStats(DEFAULT_STATS[sec])} onClose={() => setPicking(false)} />
      )}
    </div>
  )
}

/** Why some stats read "—" with the current filters. */
function noteFor(data: LeadersResponse | undefined, sec: Section, hand: LeaderHand, role: LeaderRole,
  period: StatPeriod, t: ReturnType<typeof useT>): string[] {
  if (!data) return []
  if (sec === 'bat' || hand !== 'all') return []
  if (role !== 'all' && period !== 'season') return [t('noEraRoleWindow')]
  return []
}

// ── Filter chip with a dark menu ───────────────────────────────────────

/** grid: lay the options out in that many columns (short labels). */
interface MenuSection {
  title?: string
  options: [string, string][]
  /** Lay the options out in that many columns (short labels). */
  grid?: number
  /** One full-width option (a big button). */
  full?: boolean
  /** A full-width option above the section's options (e.g. a league over its teams). */
  header?: [string, string]
}

/**
 * A filter chip that opens the app's dark menu. The menu is fixed to the
 * screen (the chip row scrolls sideways and would clip it).
 */
function Dropdown({ value, sections, onChange, set, locked, lockedTitle, label: labelProp, isSelected, keepOpen }: {
  value: string; sections: MenuSection[]; onChange: (v: string) => void; set?: boolean
  /** Chip text when it isn't just the selected option's (several selections). */
  label?: string
  isSelected?: (v: string) => boolean
  /** Stay open after a pick (several choices combine). */
  keepOpen?: boolean
  /** Can't be changed now (shown with a lock); lockedTitle says why. */
  locked?: boolean; lockedTitle?: string
}) {
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const label = labelProp ?? sections.flatMap(s => s.options).find(([v]) => v === value)?.[1] ?? ''

  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => {
      const target = e.target as Node
      if (menu.current?.contains(target) || btn.current?.contains(target)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    const onScroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setPos(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', () => setPos(null), { once: true })
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [pos])

  function toggle() {
    if (pos) return setPos(null)
    const r = btn.current!.getBoundingClientRect()
    const width = 200
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      maxH: Math.max(160, window.innerHeight - r.bottom - 18),
    })
  }

  return (
    <>
      <button ref={btn} className={`${styles.chip} ${set ? styles.chipSet : ''} ${locked ? styles.chipLocked : ''}`}
        onClick={locked ? undefined : toggle} aria-disabled={locked} title={locked ? lockedTitle : undefined}
        aria-expanded={!!pos} aria-haspopup="listbox">
        <span>{label}</span>
        {locked ? <LockIcon /> : (
          <svg className={`${styles.caret} ${pos ? styles.caretOpen : ''}`} width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11L3 6h10z" /></svg>
        )}
      </button>
      {pos && (
        <div ref={menu} className={styles.menu} role="listbox" style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH }}>
          {sections.map((s, i) => {
            const pick = (v: string) => { onChange(v); if (!keepOpen) setPos(null) }
            const sel = (v: string) => (isSelected ? isSelected(v) : v === value)
            return (
              <div key={i}>
                {i > 0 && <div className={styles.menuDivider} />}
                {s.title && <div className={styles.menuTitle}>{s.title}</div>}
                <div>
                  {s.header && (
                    <div className={styles.menuWideWrap}>
                      <button role="option" aria-selected={sel(s.header[0])}
                        className={`${styles.menuWide} ${sel(s.header[0]) ? styles.menuWideOn : ''}`}
                        onClick={() => pick(s.header![0])}>{s.header[1]}</button>
                    </div>
                  )}
                  <div className={s.grid ? styles.menuGrid : s.full ? styles.menuWideWrap : undefined} style={s.grid ? { gridTemplateColumns: `repeat(${s.grid}, 1fr)` } : undefined}>
                    {s.options.map(([v, text]) => {
                      const selected = sel(v)
                      return (
                        <button key={v} role="option" aria-selected={selected}
                          className={s.full ? `${styles.menuWide} ${selected ? styles.menuWideOn : ''}` : `${styles.menuOption} ${selected ? styles.menuSelected : ''}`}
                          onClick={() => pick(v)}>
                          <span>{text}</span>
                          {selected && !s.grid && !s.full && <CheckIcon />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Stat picker ────────────────────────────────────────────────────────

function StatPicker({ sec, chosen, onChange, onReset, onClose }: {
  sec: Section; chosen: string[]; onChange: (ids: string[]) => void; onReset: () => void; onClose: () => void
}) {
  const t = useT()
  const on = new Set(chosen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(id: string) {
    if (on.has(id)) {
      if (on.size === 1) return   // at least one stat
      onChange(chosen.filter(x => x !== id))
    } else onChange([...chosen, id])
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('statsPickTitle')} onClick={e => e.stopPropagation()}>
        <div className={styles.sheetHead}>
          <div>
            <h2 className={styles.sheetTitle}>{t('statsPickTitle')}</h2>
            <p className={styles.sheetHint}>{t('statsPickHint')}</p>
          </div>
          <span className={styles.sheetCount}>{chosen.length}</span>
        </div>
        <div className={styles.sheetBody}>
          {CATALOG[sec].map(cat => (
            <section key={cat.label} className={styles.cat}>
              <h3 className={styles.catTitle}>{t(cat.label)}</h3>
              <div className={styles.catStats}>
                {cat.cols.map(c => (
                  <button key={c.id} className={`${styles.statToggle} ${on.has(c.id) ? styles.statOn : ''}`}
                    aria-pressed={on.has(c.id)} onClick={() => toggle(c.id)}>{c.label}</button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className={styles.sheetFoot}>
          <button className={styles.resetBtn} onClick={onReset}>{t('statsReset')}</button>
          <button className={styles.doneBtn} onClick={onClose}>{t('statsDone')}</button>
        </div>
      </div>
    </div>
  )
}

// ── Row ───────────────────────────────────────────────────────────────

function StatRow({ row, subLeagues, order, rank, sortCol, scale, cols, pool, poolNote, open, onToggle }: {
  /** The league has AL / NL: a team row says which. */
  subLeagues: boolean
  /** Place in the batch just shown, to stagger the entrance. */
  order: number
  /** The league-wide sample the percentiles compare against, and how to say it. */
  pool: AnyRow[]; poolNote: string
  row: AnyRow; rank: number; sortCol: Column; scale: BarScale; cols: Column[]; open: boolean; onToggle: () => void
}) {
  const t = useT()
  const team = isTeamRow(row) ? row.id : row.team
  const meta = getTeamMeta(team)
  const name = isTeamRow(row) ? (meta ? `${meta.name} ${meta.brief}` : String(row.id)) : row.name
  // TV style: first name (a team's city) small on top, last name (nickname) big
  const [first, last] = isTeamRow(row)
    ? (meta ? [meta.name, meta.brief] : ['', name])
    : (() => { const [f, ...r] = row.name.split(' '); return r.length ? [f, r.join(' ')] : ['', f] })()
  // team · position / hand · the sample
  const sub = [
    isTeamRow(row) ? (meta && subLeagues ? teamLeague(meta) : '') : meta?.abbr,
    isTeamRow(row) ? '' : 'pos' in row ? row.pos : row.throws ? `${row.throws}HP` : '',
    sampleOf(row).slice(0, 1).map(([k, s]) => `${s} ${k}`)[0],
  ].filter(Boolean).join(' · ')
  const href = isTeamRow(row) ? `/team/${row.id}` : `/player/${row.id}`

  // The detail mounts shut on the first open and unfolds a frame later (a transition
  // needs a "before"); after that it stays mounted and just folds.
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  const [shown, setShown] = useState(open)
  // Each open replays the percentile bars' spring (the detail's key)
  const [opens, setOpens] = useState(0)
  useEffect(() => { if (open) setOpens(n => n + 1) }, [open])
  useEffect(() => {
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => setShown(open)) })
    return () => cancelAnimationFrame(id)
  }, [open])

  const v = sortCol.get(row)
  const fill = v != null && Number.isFinite(v) ? onScale(v, scale, sortCol.low) : 0
  const midAt = onScale(scale.mid, scale, sortCol.low)

  return (
    // Team colors: the plate (and, open, the card) in its main color, the bar in its bar color
    <div className={`${styles.item} ${open ? styles.itemOpen : ''}`}
      style={{ '--i': order, ...(meta ? { '--team': cardTone(meta.color), '--team-bar': getBarColor(meta) } : {}) } as CSSProperties}>
      {/* The cap logo, faded: behind the cutout in the plate; open, it grows into the
          card's watermark. Teams have it as their plate, so theirs only shows open. */}
      {meta && (
        <span className={styles.logoLayer} aria-hidden="true">
          <img className={`${styles.tileLogo} ${isTeamRow(row) ? styles.logoOpenOnly : ''}`} src={capLogoUrl(team)} alt="" loading="lazy" />
        </span>
      )}
      <button className={styles.row} onClick={onToggle} aria-expanded={open}>
        {/* The team plate: rank and the player's cutout (a team: its logo) */}
        <span className={styles.plate}>
          <span className={styles.rank}>{rank}</span>
          {isTeamRow(row) ? (
            <img className={styles.tileLogoBig} src={capLogoUrl(team)} alt="" loading="lazy" />
          ) : (
            <img className={styles.tilePhoto} src={cutoutUrl(row.id, 120)} alt="" loading="lazy"
              onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }} />
          )}
        </span>

        <span className={styles.body}>
          <span className={styles.head}>
            <span className={styles.who}>
              {first && <span className={styles.first}>{first}</span>}
              <span className={styles.last} title={name}>{last}</span>
              <span className={styles.meta}>{sub}</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.val}><AnimatedStat value={v} col={sortCol} delay={Math.min(order, 12) * 35 + 80} /></span>
            </span>
          </span>
          {/* Open, the detail shows this stat's bar too: this one folds away */}
          <span className={`${styles.fold} ${open ? styles.foldShut : ''}`} aria-hidden={open}>
            <span className={styles.foldInner}>
              <span className={styles.bar}>
                <span className={styles.barFill} style={fillStyle(fill)} />
                <span className={styles.barMark} style={{ left: `${midAt}%` }} />
              </span>
            </span>
          </span>
        </span>
      </button>

      {/* Mounted on the first open and kept, so it folds shut as smoothly as it opens */}
      {opened && (
        <div className={`${styles.fold} ${shown ? '' : styles.foldShut}`} aria-hidden={!open}>
        <div className={styles.foldInner}>
        <div key={opens} className={styles.detail}>
          <div className={styles.sample}>{sampleOf(row).map(([k, val]) => <span key={k}>{k} <b>{val}</b></span>)}</div>
          {cols.map(c => {
            const v = c.get(row)
            const vals = pool.map(c.get).filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
            const p = v != null && vals.length ? percentile(vals, v, c.low) : null
            return (
              <div key={c.id} className={`${styles.pr} ${c.id === sortCol.id ? styles.prOn : ''}`}
                style={p != null ? { '--p': savant(p) } as CSSProperties : undefined}>
                <span className={styles.prLabel}>{c.label}</span>
                <span className={styles.track}>
                  {p != null && <span className={styles.fill} style={fillStyle(p)} />}
                </span>
                {/* the percentile counts up in step with its bar */}
                {p != null ? <span className={styles.knob}><CountUp value={Math.round(p)} delay={120} duration={fillMs(p)} /></span> : <span />}
                <span className={styles.prVal}>{formatStat(v, c.fmt)}</span>
              </div>
            )
          })}
          <div className={styles.detailFoot}>
            <span>{poolNote}</span>
            <Link to={href} className={styles.profile} tabIndex={open ? undefined : -1}>{t('viewProfile')} ›</Link>
          </div>
        </div>
        </div>
        </div>
      )}
    </div>
  )
}

/** A bar filled to `width`%, growing in at its pace (see fillMs). */
function fillStyle(width: number): CSSProperties {
  return { width: `${width}%`, '--fill-dur': `${fillMs(width)}ms` } as CSSProperties
}

/** Fill time for a bar of `width`%: the higher, the quicker (100 → 0.5s, 50 → 0.85s, 0 → 1.2s). */
function fillMs(width: number): number {
  return Math.round(1200 - 7 * Math.max(0, Math.min(100, width)))
}

/**
 * The team color for a card's background, its lightness capped so white text
 * reads on it: navy and red stay as they are, gold and orange come down to a
 * deeper shade of themselves (hue and saturation kept).
 */
function cardTone(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  // Perceived brightness decides: yellow is light at a lightness that leaves blue dark
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const cap = luma > 0.45 ? 0.38 : luma > 0.3 ? 0.44 : 1
  return `hsl(${Math.round(h * 60 + 360) % 360} ${Math.round(s * 100)}% ${Math.round(Math.min(l, cap) * 100)}%)`
}

/** Baseball Savant's percentile scale, on dark: blue (poor) → grey (average) → red (elite). */
function savant(p: number): string {
  return p <= 50
    ? `color-mix(in srgb, #8a92a3 ${p * 2}%, #3d74d9)`
    : `color-mix(in srgb, #e5484d ${(p - 50) * 2}%, #8a92a3)`
}

/** The sample behind a line: PA (batters), IP and BF (pitchers), games (teams). */
function sampleOf(row: AnyRow): [string, string][] {
  if (isTeamRow(row)) return [['G', String(row.g)], ['PA', String(row.bat.pa)], ['IP', formatStat(row.pit.ip, 'ip')]]
  if ('pa' in row) return [['PA', String(row.pa)], ['G', String(row.g)]]
  return [['IP', formatStat(row.ip, 'ip')], ['BF', String(row.bf)], ['G', String(row.g)]]
}

/**
 * The value counting up to its number (from 0 when it appears or the stat
 * changes, from the old value when only the number changes), in the stat's format.
 */
function AnimatedStat({ value, col, delay }: { value: number | null | undefined; col: Column; delay: number }) {
  const target = value != null && Number.isFinite(value) ? value : null
  const [shown, setShown] = useState<number | null>(target == null ? null : 0)
  const last = useRef<{ col: string; v: number }>({ col: col.id, v: 0 })
  const first = useRef(true)

  useEffect(() => {
    if (target == null || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(target)
      return
    }
    const from = last.current.col === col.id ? last.current.v : 0
    const wait = first.current ? delay : 0
    first.current = false
    let frame = 0
    const start = performance.now() + wait
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / 650))
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3))
      setShown(v)
      last.current = { col: col.id, v }
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // delay only matters for the first run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, col.id])

  return <>{formatStat(shown ?? target, col.fmt)}</>
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2.2" fill="currentColor" /><circle cx="15" cy="12" r="2.2" fill="currentColor" /><circle cx="7" cy="18" r="2.2" fill="currentColor" />
    </svg>
  )
}

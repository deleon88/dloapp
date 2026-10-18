import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchLeaders, type BatterRow, type LeaderHand, type LeaderRole, type LeadersResponse, type PitcherRow, type TeamRow,
} from '@/api/leaders'
import { capLogoUrl, getMlbClubs, getTeamMeta, teamLeague } from '@/data/teams'
import { useT } from '@/i18n/useT'
import { currentSeason, PERIOD_OPTIONS, type StatPeriod } from '@/utils/period'
import { cutoutUrl } from '@/features/live-game/mlbImages'
import {
  CATALOG, columnsFor, DEFAULT_SORT, DEFAULT_STATS, formatStat, type AnyRow, type Column, type Section,
} from './columns'
import styles from './StatsPage.module.css'

/** Rows rendered before "Show more" (images are the heavy part). */
const PAGE = 60

const BAT_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] as const
const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF'])

type Min = 'q' | 'all' | number
const MIN_PA = [50, 100, 200, 300]
const MIN_IP = [10, 20, 50, 100]

const isTeamRow = (r: AnyRow): r is TeamRow => 'bat' in r

function splitName(full: string): [string, string] {
  const [first, ...rest] = full.trim().split(' ')
  return rest.length ? [first, rest.join(' ')] : ['', first]
}

/** Percentile (0–100, higher = better) of `v` among `vals` (ascending). */
function percentile(vals: number[], v: number, low?: boolean): number {
  let below = 0, equal = 0
  for (const x of vals) { if (x < v) below++; else if (x === v) equal++ }
  const p = vals.length > 1 ? ((below + (equal - 1) / 2) / (vals.length - 1)) * 100 : 50
  return low ? 100 - p : p
}

/** Blue (worse) → slate (average) → red (better), as on Baseball Savant. */
function heat(p: number): string {
  const a = [43, 94, 168], m = [70, 80, 104], b = [190, 58, 58]
  const t = Math.max(0, Math.min(100, p)) / 100
  const [x, y, u] = t < 0.5 ? [a, m, t * 2] : [m, b, (t - 0.5) * 2]
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * u)).join(',')})`
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
  const [sec, setSec] = useState<Section>('bat')
  const [season, setSeason] = useState(currentSeason())
  const [period, setPeriod] = useState<StatPeriod>('season')
  const [hand, setHand] = useState<LeaderHand>('all')
  const [role, setRole] = useState<LeaderRole>('all')
  const [min, setMin] = useState<Min>('q')
  /** 'all', 't:<teamId>' or 'p:<position>' — one selector for both. */
  const [scope, setScope] = useState('all')
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
  const asc = sortCol.id === sort.id ? sort.asc : !!sortCol.low

  const query = useQuery({
    queryKey: ['leaders', sec, season, period, hand, sec === 'bat' ? 'all' : role],
    queryFn: () => fetchLeaders({ type: sec, season, period, hand, role }),
    staleTime: 30 * 60_000,
    // Keep the old list while the next one loads, only within the same section.
    placeholderData: prev => (prev?.type === sec ? prev : undefined),
  })
  const data = query.data

  // Filter (min sample, team / position, league), then sort; nulls always last.
  const rows = useMemo(() => {
    if (!data) return []
    const games = 'teamGames' in data ? data.teamGames : {}
    // With a hand filter, "qualified" scales by the league's share of PAs vs that hand.
    const share = 'qualShare' in data ? data.qualShare : 1
    const list: AnyRow[] = data.type === 'team' ? data.teams : data.players
    const filtered = list.filter(r => {
      const team = isTeamRow(r) ? r.id : r.team
      if (scope.startsWith('t:') && team !== Number(scope.slice(2))) return false
      if (league !== 'all') {
        const meta = getTeamMeta(team)
        if (!meta || teamLeague(meta) !== league) return false
      }
      if (data.type === 'bat') {
        const b = r as BatterRow
        if (scope.startsWith('p:')) {
          const want = scope.slice(2), p = b.pos === 'TWP' ? 'DH' : b.pos
          if (want === 'OF' ? !OUTFIELD.has(p) : p !== want) return false
        }
        if (min === 'q') return b.pa >= 3.1 * share * (games[b.team] ?? 0)
        if (typeof min === 'number') return b.pa >= min
      }
      if (data.type === 'pit') {
        const p = r as PitcherRow
        // Relievers don't reach 1 IP per team game: a third of it.
        if (min === 'q') return p.ip >= (role === 'rp' ? 1 / 3 : 1) * share * (games[p.team] ?? 0)
        if (typeof min === 'number') return p.ip >= min
      }
      return true
    })
    const dir = asc ? 1 : -1
    return filtered.sort((a, b) => {
      const x = sortCol.get(a), y = sortCol.get(b)
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      return (x - y) * dir
    })
  }, [data, scope, league, min, role, sortCol, asc])

  function changeSection(s: Section) {
    setSec(s)
    const first = columnsFor(s, chosen[s]).find(c => c.id === DEFAULT_SORT[s]) ?? columnsFor(s, chosen[s])[0]
    setSort({ id: first.id, asc: !!first.low })
    setOpen(null); setLimit(PAGE); setScope('all'); setMin('q'); setRole('all')
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
  const clubs = useMemo(() => getMlbClubs().sort((a, b) => a.abbr.localeCompare(b.abbr)), [])
  // "NYY" for a team; "AL · SS" / "SS" for a position; else the league ("MLB" by default)
  const leagueText = league === 'all' ? t('allLeagues') : league
  const scopeLabel = scope.startsWith('t:') ? getTeamMeta(Number(scope.slice(2)))?.abbr ?? ''
    : scope.startsWith('p:') ? (league === 'all' ? scope.slice(2) : `${league} · ${scope.slice(2)}`)
    : leagueText
  const notes = noteFor(data, sec, hand, role, period, t)

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
        <Dropdown value={String(season)} set={season !== currentSeason()} onChange={v => setSeason(Number(v))}
          sections={[{ options: [currentSeason(), currentSeason() - 1].map(y => [String(y), String(y)]) }]} />
        <Dropdown value={period} set={period !== 'season'} onChange={v => setPeriod(v as StatPeriod)}
          sections={[{ options: PERIOD_OPTIONS.map(o => [o.value, o.value === 'season' ? t('periodSeason') : t(o.value)]) }]} />
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
          // League, position and team in one chip: MLB / AL / NL on top, the teams split by league.
          <Dropdown value={scope} set={scope !== 'all' || league !== 'all'} label={scopeLabel}
            isSelected={v => v === scope || v === `L:${league}`}
            onChange={v => {
              if (!v.startsWith('L:')) return setScope(v)
              const lg = v.slice(2) as 'all' | 'AL' | 'NL'
              setLeague(lg)
              // A team of the other league no longer fits
              const meta = scope.startsWith('t:') ? getTeamMeta(Number(scope.slice(2))) : undefined
              if (lg !== 'all' && meta && teamLeague(meta) !== lg) setScope('all')
            }}
            sections={[
              { title: t('leagueLabel'), options: [['L:all', t('allLeagues')], ['L:AL', 'AL'], ['L:NL', 'NL']], grid: 3 },
              ...(sec === 'bat' ? [{ title: t('positionsLabel'), options: BAT_POSITIONS.map(p => [`p:${p}`, p] as [string, string]), grid: 5 }] : []),
              ...(['AL', 'NL'] as const).filter(lg => league === 'all' || league === lg).map(lg => ({
                title: lg, grid: 3,
                options: clubs.filter(c => teamLeague(c) === lg).map(c => [`t:${c.id}`, c.abbr] as [string, string]),
              })),
            ]} />
        ) : (
          <Dropdown value={league} set={league !== 'all'} onChange={v => setLeague(v as 'all' | 'AL' | 'NL')}
            sections={[{ options: [['all', t('allLeagues')], ['AL', 'AL'], ['NL', 'NL']] }]} />
        )}
      </div>

      {/* Sort: tap a stat (again to flip), the arrow flips too; Stats picks which ones show */}
      <div className={styles.toolbar}>
        <div ref={pillsRef} className={`${styles.pills} ${pillsMore ? styles.pillsFade : ''}`} onScroll={checkPills}>
          {cols.map(c => (
            <button key={c.id} className={`${styles.pill} ${c.id === sortCol.id ? styles.pillOn : ''}`} onClick={() => sortBy(c)}>{c.label}</button>
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
          <StatRow key={r.id} row={r} rank={asc === !!sortCol.low ? i + 1 : rows.length - i} sortCol={sortCol} cols={cols} pool={rows}
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
interface MenuSection { title?: string; options: [string, string][]; grid?: number }

/**
 * A filter chip that opens the app's dark menu. The menu is fixed to the
 * screen (the chip row scrolls sideways and would clip it).
 */
function Dropdown({ value, sections, onChange, set, locked, lockedTitle, label: labelProp, isSelected }: {
  value: string; sections: MenuSection[]; onChange: (v: string) => void; set?: boolean
  /** Chip text when it isn't just the selected option's (several selections). */
  label?: string
  isSelected?: (v: string) => boolean
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
          {sections.map((s, i) => (
            <div key={i}>
              {i > 0 && <div className={styles.menuDivider} />}
              {s.title && <div className={styles.menuTitle}>{s.title}</div>}
              <div className={s.grid ? styles.menuGrid : undefined} style={s.grid ? { gridTemplateColumns: `repeat(${s.grid}, 1fr)` } : undefined}>
                {s.options.map(([v, text]) => {
                  const selected = isSelected ? isSelected(v) : v === value
                  return (
                    <button key={v} role="option" aria-selected={selected}
                      className={`${styles.menuOption} ${selected ? styles.menuSelected : ''}`}
                      onClick={() => { onChange(v); setPos(null) }}>
                      <span>{text}</span>
                      {selected && !s.grid && <CheckIcon />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
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

function StatRow({ row, rank, sortCol, cols, pool, open, onToggle }: {
  row: AnyRow; rank: number; sortCol: Column; cols: Column[]; pool: AnyRow[]; open: boolean; onToggle: () => void
}) {
  const t = useT()
  const team = isTeamRow(row) ? row.id : row.team
  const meta = getTeamMeta(team)
  const [first, last] = isTeamRow(row) ? [meta ? teamLeague(meta) : '', meta?.brief ?? String(row.id)] : splitName(row.name)
  const sub = isTeamRow(row) ? ''
    : [meta?.abbr, 'pos' in row ? row.pos : row.throws ? `${row.throws}HP` : ''].filter(Boolean).join(' · ')
  const img = isTeamRow(row) ? capLogoUrl(row.id) : cutoutUrl(row.id, 96)
  const href = isTeamRow(row) ? `/team/${row.id}` : `/player/${row.id}`

  return (
    <div className={`${styles.item} ${open ? styles.itemOpen : ''}`}>
      <button className={styles.row} onClick={onToggle} aria-expanded={open}>
        <span className={styles.rank}>{rank}</span>
        <img className={isTeamRow(row) ? styles.cap : styles.photo} src={img} alt="" loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0' }} />
        <span className={styles.who}>
          <span className={styles.first}>{first}{sub && <span className={styles.sub}> · {sub}</span>}</span>
          <span className={styles.last}>{last}</span>
        </span>
        <span className={styles.val}>{formatStat(sortCol.get(row), sortCol.fmt)}</span>
        <span className={styles.chev} aria-hidden="true">›</span>
      </button>

      {open && (
        <div className={styles.detail}>
          {cols.map(c => {
            const v = c.get(row)
            const vals = pool.map(c.get).filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b)
            const p = v != null && vals.length ? percentile(vals, v, c.low) : null
            return (
              <div key={c.id} className={`${styles.pr} ${c.id === sortCol.id ? styles.prOn : ''}`}>
                <span className={styles.prLabel}>{c.label}</span>
                <span className={styles.track}>
                  {p != null && <>
                    <span className={styles.fill} style={{ width: `${p}%`, background: heat(p) }} />
                    <span className={styles.knob} style={{ left: `${p}%`, background: heat(p) }}>{Math.round(p)}</span>
                  </>}
                </span>
                <span className={styles.prVal}>{formatStat(v, c.fmt)}</span>
              </div>
            )
          })}
          <div className={styles.detailFoot}>
            <span>{t('percentileNote')}</span>
            <Link to={href} className={styles.profile}>{t('viewProfile')} ›</Link>
          </div>
        </div>
      )}
    </div>
  )
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

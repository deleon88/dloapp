import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchLeaders, type BatterRow, type LeaderHand, type LeaderRole, type LeadersResponse, type PitcherRow, type TeamRow,
} from '@/api/leaders'
import { capLogoUrl, getMlbClubs, getTeamMeta, teamLeague } from '@/data/teams'
import { useT } from '@/i18n/useT'
import { currentSeason, PERIOD_OPTIONS, type StatPeriod } from '@/utils/period'
import { cutoutUrl } from '@/features/live-game/mlbImages'
import { formatStat, GROUPS, type AnyRow, type Column, type Section } from './columns'
import styles from './StatsPage.module.css'

/** Rows rendered before "Show more" (images are the heavy part). */
const PAGE = 60

const BAT_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH'] as const
const OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF'])

type Min = 'q' | 'all' | number
const MIN_PA = [50, 100, 200, 300]
const MIN_IP = [10, 20, 50, 100]

const rowId = (r: AnyRow) => r.id
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

export default function StatsPage() {
  const t = useT()
  const [sec, setSec] = useState<Section>('bat')
  const [season, setSeason] = useState(currentSeason())
  const [period, setPeriod] = useState<StatPeriod>('season')
  const [hand, setHand] = useState<LeaderHand>('all')
  const [role, setRole] = useState<LeaderRole>('all')
  const [min, setMin] = useState<Min>('q')
  const [teamId, setTeamId] = useState(0)
  const [pos, setPos] = useState('all')
  const [league, setLeague] = useState<'all' | 'AL' | 'NL'>('all')
  const [groupId, setGroupId] = useState(GROUPS.bat[0].id)
  const [sort, setSort] = useState({ id: GROUPS.bat[0].def, asc: false })
  const [open, setOpen] = useState<number | null>(null)
  const [limit, setLimit] = useState(PAGE)

  const groups = GROUPS[sec]
  const group = groups.find(g => g.id === groupId) ?? groups[0]
  const sortCol = group.cols.find(c => c.id === sort.id) ?? group.cols.find(c => c.id === group.def)!

  const query = useQuery({
    queryKey: ['leaders', sec, season, period, hand, sec === 'bat' ? 'all' : role],
    queryFn: () => fetchLeaders({ type: sec, season, period, hand, role }),
    staleTime: 30 * 60_000,
    // Keep the old list while the next one loads, only within the same section.
    placeholderData: prev => (prev?.type === sec ? prev : undefined),
  })
  const data = query.data

  // Filter (min sample, team, position, league), then sort; nulls always last.
  const rows = useMemo(() => {
    if (!data) return []
    const games = 'teamGames' in data ? data.teamGames : {}
    const list: AnyRow[] = data.type === 'team' ? data.teams : data.players
    const filtered = list.filter(r => {
      const team = isTeamRow(r) ? r.id : r.team
      if (teamId && team !== teamId) return false
      if (league !== 'all') {
        const meta = getTeamMeta(team)
        if (!meta || teamLeague(meta) !== league) return false
      }
      if (data.type === 'bat') {
        const b = r as BatterRow
        if (pos !== 'all') {
          const p = b.pos === 'TWP' ? 'DH' : b.pos
          if (pos === 'OF' ? !OUTFIELD.has(p) : p !== pos) return false
        }
        if (min === 'q') return b.pa >= 3.1 * (games[b.team] ?? 0)
        if (typeof min === 'number') return b.pa >= min
      }
      if (data.type === 'pit') {
        const p = r as PitcherRow
        // Relievers don't reach 1 IP per team game: a third of it.
        if (min === 'q') return p.ip >= (role === 'rp' ? 1 / 3 : 1) * (games[p.team] ?? 0)
        if (typeof min === 'number') return p.ip >= min
      }
      return true
    })
    const dir = sort.asc ? 1 : -1
    return filtered.sort((a, b) => {
      const x = sortCol.get(a), y = sortCol.get(b)
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      return (x - y) * dir
    })
  }, [data, teamId, league, pos, min, role, sortCol, sort.asc])

  function changeSection(s: Section) {
    const g = GROUPS[s][0]
    setSec(s); setGroupId(g.id); setSort({ id: g.def, asc: !!g.cols.find(c => c.id === g.def)?.low })
    setOpen(null); setLimit(PAGE); setPos('all'); setMin('q'); setRole('all')
  }
  function changeGroup(id: string) {
    const g = groups.find(x => x.id === id)!
    setGroupId(id); setOpen(null)
    // Keep the sort column when the new group has it; else the group's default.
    if (!g.cols.some(c => c.id === sort.id)) setSort({ id: g.def, asc: !!g.cols.find(c => c.id === g.def)?.low })
  }
  function sortBy(col: Column) {
    setSort(s => (s.id === col.id ? { id: col.id, asc: !s.asc } : { id: col.id, asc: !!col.low }))
    setLimit(PAGE)
  }

  const secIdx = ['bat', 'pit', 'team'].indexOf(sec)
  const handLabels = sec === 'pit'
    ? [t('statsVsLhb'), t('statsVsRhb')]
    : sec === 'bat' ? [t('statsVsLhp'), t('statsVsRhp')]
    : group.id === 'tpit' ? [t('statsVsLhb'), t('statsVsRhb')] : [t('statsVsLhp'), t('statsVsRhp')]
  const showRole = sec === 'pit' || (sec === 'team' && group.id === 'tpit')
  const notes = noteFor(data, sec, hand, role, period, group.id, t)

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
        <Chip set={season !== currentSeason()} value={season} onChange={v => setSeason(Number(v))}
          options={[currentSeason(), currentSeason() - 1].map(y => [String(y), String(y)])} />
        <Chip set={period !== 'season'} value={period} onChange={v => setPeriod(v as StatPeriod)}
          options={PERIOD_OPTIONS.map(o => [o.value, o.value === 'season' ? t('periodSeason') : t(o.value)])} />
        <Chip set={hand !== 'all'} value={hand} onChange={v => setHand(v as LeaderHand)}
          options={[['all', t('statsVsAll')], ['L', handLabels[0]], ['R', handLabels[1]]]} />
        {showRole && (
          <Chip set={role !== 'all'} value={role} onChange={v => setRole(v as LeaderRole)}
            options={[['all', t('roleAll')], ['sp', t('roleSp')], ['rp', t('roleRp')]]} />
        )}
        {sec !== 'team' && (
          <Chip set={min !== 'q'} value={String(min)} onChange={v => setMin(v === 'q' || v === 'all' ? v : Number(v))}
            options={[['q', t('minQualified')], ['all', t('minAll')],
              ...(sec === 'bat' ? MIN_PA.map(n => [String(n), `≥ ${n} PA`]) : MIN_IP.map(n => [String(n), `≥ ${n} IP`]))] as [string, string][]} />
        )}
        {sec !== 'team' && (
          <Chip set={teamId !== 0} value={teamId} onChange={v => setTeamId(Number(v))}
            options={[['0', t('allTeams')], ...getMlbClubs().sort((a, b) => a.abbr.localeCompare(b.abbr)).map(c => [String(c.id), c.abbr] as [string, string])]} />
        )}
        {sec === 'bat' && (
          <Chip set={pos !== 'all'} value={pos} onChange={setPos}
            options={[['all', t('allPositions')], ...BAT_POSITIONS.map(p => [p, p] as [string, string])]} />
        )}
        <Chip set={league !== 'all'} value={league} onChange={v => setLeague(v as 'all' | 'AL' | 'NL')}
          options={[['all', t('allLeagues')], ['AL', 'AL'], ['NL', 'NL']]} />
      </div>

      <div className={styles.groups}>
        {groups.map(g => (
          <button key={g.id} className={`${styles.groupBtn} ${g.id === group.id ? styles.groupOn : ''}`} onClick={() => changeGroup(g.id)}>
            {t(g.label)}
          </button>
        ))}
      </div>

      <div className={styles.sortRow}>
        <label className={styles.sortSel}>
          <span className={styles.sortLabel}>{t('sortBy')}</span>
          <select value={sortCol.id} onChange={e => sortBy(group.cols.find(c => c.id === e.target.value)!)}>
            {group.cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <button className={styles.dirBtn} onClick={() => setSort(s => ({ ...s, asc: !s.asc }))}
          aria-label={sort.asc ? '↑' : '↓'}>{sort.asc ? '↑' : '↓'}</button>
      </div>
      <div className={styles.pills}>
        {group.cols.map(c => (
          <button key={c.id} className={`${styles.pill} ${c.id === sortCol.id ? styles.pillOn : ''}`} onClick={() => sortBy(c)}>{c.label}</button>
        ))}
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
          <StatRow key={rowId(r)} row={r} rank={i + 1} sortCol={sortCol} cols={group.cols} pool={rows}
            open={open === rowId(r)} onToggle={() => setOpen(o => (o === rowId(r) ? null : rowId(r)))} />
        ))}

        {rows.length > limit && (
          <button className={styles.more} onClick={() => setLimit(l => l + PAGE)}>
            {t('showMore')} · {rows.length - limit}
          </button>
        )}
      </div>

      {notes.length > 0 && <div className={styles.notes}>{notes.map(n => <p key={n}>{n}</p>)}</div>}
    </div>
  )
}

/** Why some columns read "—" with the current filters. */
function noteFor(data: LeadersResponse | undefined, sec: Section, hand: LeaderHand, role: LeaderRole,
  period: StatPeriod, groupId: string, t: ReturnType<typeof useT>): string[] {
  if (!data) return []
  if (sec === 'bat' && hand !== 'all') return [t('noRunsHand')]
  const pitching = sec === 'pit' || (sec === 'team' && groupId === 'tpit')
  if (pitching && hand !== 'all') return [t('noEraHand')]
  if (pitching && role !== 'all' && period !== 'season') return [t('noEraRoleWindow')]
  return []
}

/** A filter as a chip: a styled native select (the phone's own picker). */
function Chip({ value, options, onChange, set }: {
  value: string | number; options: [string, string][]; onChange: (v: string) => void; set?: boolean
}) {
  return (
    <label className={`${styles.chip} ${set ? styles.chipSet : ''}`}>
      <select value={String(value)} onChange={e => onChange(e.target.value)}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <span className={styles.chipText}>{options.find(([v]) => v === String(value))?.[1]}</span>
      <svg className={styles.caret} width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11L3 6h10z" /></svg>
    </label>
  )
}

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

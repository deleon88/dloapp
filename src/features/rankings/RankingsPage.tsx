import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRankings, type RankingPeriod, type RankingRow } from '@/api/votes'
import UserAvatar from '@/components/UserAvatar/UserAvatar'
import { useAuthStore } from '@/stores/authStore'
import { useLangStore } from '@/stores/langStore'
import { useT, type TKey } from '@/i18n/useT'
import styles from './RankingsPage.module.css'

const PERIODS: Array<{ id: RankingPeriod; label: TKey }> = [
  { id: 'today', label: 'periodToday' },
  { id: 'week', label: 'periodWeek' },
  { id: 'month', label: 'periodMonth' },
  { id: 'season', label: 'periodSeason' },
]
const COLLAPSED_ROWS = 10   // podium + the next 7, until "see all"

/** Picks leaderboard: podium for the top 3, then the table. */
export default function RankingsPage() {
  const t = useT()
  const lang = useLangStore(s => s.lang)
  const me = useAuthStore(s => s.profile?.username ?? null)
  const [period, setPeriod] = useState<RankingPeriod>('week')
  const [expanded, setExpanded] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const query = useQuery({
    queryKey: ['rankings', period],
    queryFn: () => fetchRankings(period),
    staleTime: 60_000,
    placeholderData: prev => prev,
  })
  const data = query.data
  const rows = data?.rows ?? []
  const podium = rows.slice(0, 3)
  const rest = rows.slice(3, expanded ? undefined : COLLAPSED_ROWS)
  // Collapsed and you're further down: your row stays visible at the end.
  const mineBelow = !expanded && me ? rows.slice(COLLAPSED_ROWS).find(r => r.username === me) : undefined

  const fmt = (d: string, withYear = false) => new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`))
  const range = !data ? '' : period === 'season' ? data.from.slice(0, 4)
    : data.from === data.to ? fmt(data.to) : `${fmt(data.from)} – ${fmt(data.to)}`
  const count = rows.length === 1 ? t('oneParticipant') : t('participants').replace('{n}', String(rows.length))

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('rankingsTitle')}</h1>
        <p className={styles.sub}>{t('rankingsSub')}</p>
      </header>

      <div className={styles.tabs} role="tablist">
        {PERIODS.map(p => (
          <button key={p.id} type="button" role="tab" aria-selected={period === p.id}
            className={`${styles.tab} ${period === p.id ? styles.tabActive : ''}`}
            onClick={() => { setPeriod(p.id); setExpanded(false) }}>
            {t(p.label)}
          </button>
        ))}
      </div>

      <div className={styles.metaRow}>
        <span>{range}{range && ' · '}{count}</span>
        <button type="button" className={styles.rulesBtn} aria-expanded={rulesOpen} onClick={() => setRulesOpen(o => !o)}>
          {t('rankingRules')}
        </button>
      </div>
      {rulesOpen && <p className={styles.rules}>{t('rankingRulesText')}</p>}

      {query.isLoading ? (
        <p className={styles.state}>{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.state}>{t('noRankingYet')}</p>
      ) : (
        <>
          <div className={styles.podium}>
            {/* #2 · #1 · #3 — empty places keep the leader in the middle */}
            {[podium[1], podium[0], podium[2]].map((r, i) => r
              ? <PodiumCard key={r.username} row={r} first={i === 1} isMe={r.username === me} />
              : <div key={`empty-${i}`} aria-hidden="true" />)}
          </div>

          {rest.length > 0 && (
            <div className={styles.table} role="table">
              <div className={`${styles.row} ${styles.headRow}`} role="row">
                <span role="columnheader">#</span>
                <span role="columnheader">{t('userCol')}</span>
                <span role="columnheader" className={styles.num}>{t('hitsCol')}</span>
                <span role="columnheader" className={styles.num}>{t('hitRate')}</span>
              </div>
              {rest.map(r => <TableRow key={r.username} row={r} isMe={r.username === me} />)}
              {mineBelow && (
                <>
                  <div className={styles.gap} aria-hidden="true">⋯</div>
                  <TableRow row={mineBelow} isMe />
                </>
              )}
            </div>
          )}

          {!expanded && rows.length > COLLAPSED_ROWS && (
            <button type="button" className={styles.seeAll} onClick={() => setExpanded(true)}>
              {t('seeAllParticipants').replace('{n}', String(rows.length))}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function PodiumCard({ row, first, isMe }: { row: RankingRow; first: boolean; isMe: boolean }) {
  const t = useT()
  return (
    <div className={`${styles.podiumCard} ${first ? styles.podiumFirst : ''} ${isMe ? styles.me : ''}`}>
      <span className={styles.podiumRank}>#{row.rank}{first ? ` · ${t('leader')}` : ''}</span>
      <UserAvatar name={row.username} teamId={row.favoriteTeamId} size={first ? 44 : 38} />
      <span className={styles.podiumName}>{row.username}{isMe ? ` · ${t('you')}` : ''}</span>
      <span className={styles.podiumHits}>{row.correct}</span>
      <span className={styles.podiumFoot}>{t('hitsLabel')} · {row.pct}%</span>
    </div>
  )
}

function TableRow({ row, isMe }: { row: RankingRow; isMe: boolean }) {
  const t = useT()
  return (
    <div className={`${styles.row} ${isMe ? styles.me : ''}`} role="row">
      <span className={styles.rank}>{row.rank}</span>
      <span className={styles.user}>
        <UserAvatar name={row.username} teamId={row.favoriteTeamId} size={28} />
        <span className={styles.userName}>{row.username}{isMe ? ` · ${t('you')}` : ''}</span>
      </span>
      <span className={`${styles.num} ${styles.hits}`}>{row.correct}</span>
      <span className={`${styles.num} ${styles.pct}`}>{row.pct}%</span>
    </div>
  )
}

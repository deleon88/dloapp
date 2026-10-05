import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchPickHistory, type Pick, type PickResult } from '@/api/votes'
import { capLogoUrl, getTeamMeta } from '@/data/teams'
import { useLangStore } from '@/stores/langStore'
import { useT, type TKey } from '@/i18n/useT'
import styles from './PickHistory.module.css'

const RESULT: Record<PickResult, { label: TKey; className: string }> = {
  won: { label: 'pickWon', className: styles.won },
  lost: { label: 'pickLost', className: styles.lost },
  pending: { label: 'pickPending', className: styles.pending },
  void: { label: 'pickVoid', className: styles.void },
}

/** The signed-in user's picks, newest first, with how each one turned out. */
export default function PickHistory({ userId }: { userId: string }) {
  const t = useT()
  const query = useQuery({
    queryKey: ['pick-history', userId],
    queryFn: fetchPickHistory,
    staleTime: 60_000,
  })
  const picks = query.data?.picks ?? []
  const s = query.data?.summary
  const decided = s ? s.won + s.lost : 0
  // Current run: "+3" correct in a row, "−2" missed in a row.
  const streak = s?.streak ? `${s.streak.kind === 'won' ? '+' : '−'}${s.streak.n}` : '—'

  return (
    <section className={styles.card} aria-labelledby="my-picks">
      <div className={styles.head}>
        <h2 id="my-picks" className={styles.title}>{t('myPicks')}</h2>
        {s && s.pending > 0 && <span className={styles.summary}>{t('pendingCount').replace('{n}', String(s.pending))}</span>}
      </div>
      {s && decided > 0 && (
        <dl className={styles.stats}>
          <div><dt>{t('recordLabel')}</dt><dd>{s.won}-{s.lost}</dd></div>
          <div><dt>{t('hitRate')}</dt><dd>{s.pct}%</dd></div>
          <div>
            <dt>{t('streakCol')}</dt>
            <dd className={s.streak?.kind === 'won' ? styles.hot : s.streak ? styles.cold : undefined}>{streak}</dd>
          </div>
          <div><dt>{t('bestStreak')}</dt><dd>{s.bestStreak}</dd></div>
        </dl>
      )}
      {query.isLoading ? (
        <p className={styles.empty}>{t('loading')}</p>
      ) : picks.length === 0 ? (
        <p className={styles.empty}>{t('noPicksYet')}</p>
      ) : (
        <ul className={styles.list}>
          {picks.map(p => <PickRow key={p.gamePk} pick={p} />)}
        </ul>
      )}
    </section>
  )
}

function PickRow({ pick }: { pick: Pick }) {
  const t = useT()
  const lang = useLangStore(s => s.lang)
  const away = getTeamMeta(pick.awayTeamId), home = getTeamMeta(pick.homeTeamId)
  const picked = getTeamMeta(pick.teamId)
  const date = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${pick.date}T12:00:00Z`))
  // The score only once the game is over (a game that hasn't started can come back 0–0).
  const over = pick.result === 'won' || pick.result === 'lost'
  const score = over && pick.awayScore != null && pick.homeScore != null ? `${pick.awayScore}–${pick.homeScore}` : '@'
  const result = RESULT[pick.result]

  return (
    <li>
      <Link to={`/game/${pick.gamePk}`} className={styles.row}>
        <span className={styles.date}>{date}</span>
        <span className={styles.matchup}>
          {away?.abbr ?? pick.awayTeamId} <span className={styles.score}>{score}</span> {home?.abbr ?? pick.homeTeamId}
        </span>
        <span className={styles.pick}>
          <img src={capLogoUrl(pick.teamId)} alt="" width={18} height={18} />
          {picked?.brief ?? pick.teamId}
        </span>
        <span className={`${styles.result} ${result.className}`}>{t(result.label)}</span>
      </Link>
    </li>
  )
}

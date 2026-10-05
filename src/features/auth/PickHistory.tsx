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
  const picks = query.data ?? []
  const decided = picks.filter(p => p.result === 'won' || p.result === 'lost')
  const won = decided.filter(p => p.result === 'won').length

  return (
    <section className={styles.card} aria-labelledby="my-picks">
      <div className={styles.head}>
        <h2 id="my-picks" className={styles.title}>{t('myPicks')}</h2>
        {decided.length > 0 && (
          <span className={styles.summary}>
            {won}/{decided.length} · {Math.round((won / decided.length) * 100)}%
          </span>
        )}
      </div>
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
  const score = pick.awayScore != null && pick.homeScore != null ? `${pick.awayScore}–${pick.homeScore}` : '@'
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

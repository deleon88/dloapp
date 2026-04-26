import { useState, useEffect } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { getLmbSchedule } from '@/api/lmb/endpoints/schedule'
import { getLmbGameDetail } from '@/api/lmb/endpoints/gameDetail'
import DateNav from '@/features/schedule/DateNav'
import LmbGameCard from './LmbGameCard'
import { useT } from '@/i18n/useT'
import styles from './LmbSchedulePage.module.css'

export default function LmbSchedulePage() {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const scheduleQuery = useQuery({
    queryKey: ['lmb-schedule', date],
    queryFn: () => getLmbSchedule(date),
    staleTime: 30_000,
  })

  const games = scheduleQuery.data ?? []

  const detailQueries = useQueries({
    queries: games.map(g => ({
      queryKey: ['lmb-game', String(g.gameId)],
      queryFn: () => getLmbGameDetail(String(g.gameId)),
      staleTime: 3_600_000,
    })),
  })

  const today = format(new Date(), 'yyyy-MM-dd')
  useEffect(() => {
    if (date !== today) return
    if (!scheduleQuery.data || scheduleQuery.isLoading) return
    if (games.length > 0 && games.every(g => g.status === 'F')) {
      setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))
    }
  }, [scheduleQuery.data, scheduleQuery.isLoading])

  const t = useT()

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>{t('lmbGames')}</h1>
          <p className={styles.sub}>{t('lmbSub')}</p>
        </div>
      </div>

      <DateNav
        date={date}
        onPrev={() => setDate(format(subDays(parseISO(date), 1), 'yyyy-MM-dd'))}
        onNext={() => setDate(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'))}
      />

      {scheduleQuery.isLoading && <SkeletonList />}

      {scheduleQuery.error && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>{t('couldNotLoadGames')}</p>
          <p className={styles.stateDetail}>{t('checkConnection')}</p>
        </div>
      )}

      {!scheduleQuery.isLoading && !scheduleQuery.error && games.length === 0 && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>{t('noGamesScheduled')}</p>
          <p className={styles.stateDetail}>{t('tryDifferentDate')}</p>
        </div>
      )}

      <div className={styles.list}>
        {games.map((game, i) => {
          const stadium = detailQueries[i]?.data?.stadium
          return (
            <LmbGameCard
              key={game.gameId}
              game={stadium ? { ...game, stadium } : game}
              animDelay={i * 60}
            />
          )
        })}
      </div>

      <footer className={styles.footer}>
        {t('lmbData')}
      </footer>
    </div>
  )
}

function SkeletonList() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 160, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  )
}

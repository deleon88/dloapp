import { useState, useMemo } from 'react'
import { format, addDays, subDays, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { fetchNrfiRankings } from '@/api/mlb/endpoints/nrfiRankings'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import type { ScheduledGame } from '@/api/mlb/types'
import DateNav from '@/features/schedule/DateNav'
import NrfiCard from './NrfiCard'
import styles from './NrfiPage.module.css'

type Bet = 'nrfi' | 'yrfi'

function buildLineupMap(): Map<number, Array<{ id: number; fullName: string }>> {
  const map = new Map<number, Array<{ id: number; fullName: string }>>()
  try {
    const raw = localStorage.getItem('dlp-go-to-lineups-v1')
    if (!raw) return map
    const store = JSON.parse(raw) as Record<string, {
      vsRHP?: Array<{ id: number; fullName: string }>
      vsLHP?: Array<{ id: number; fullName: string }>
    }>
    for (const [teamId, entry] of Object.entries(store)) {
      const lineup = entry.vsRHP?.length ? entry.vsRHP : (entry.vsLHP ?? [])
      if (lineup.length) {
        map.set(Number(teamId), lineup.map(p => ({ id: p.id, fullName: p.fullName })))
      }
    }
  } catch {
    // ignore — localStorage unavailable or malformed
  }
  return map
}

export default function NrfiPage() {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [bet,  setBet]  = useState<Bet>('nrfi')

  const lineupMap = useMemo(() => buildLineupMap(), [])

  const scheduleQuery = useQuery({
    queryKey: ['schedule', date],
    queryFn:  () => getSchedule({ date }),
    staleTime: 30_000,
  })

  const gameMap = useMemo<Map<number, ScheduledGame>>(() => {
    const m = new Map<number, ScheduledGame>()
    for (const g of scheduleQuery.data?.dates?.[0]?.games ?? []) m.set(g.gamePk, g)
    return m
  }, [scheduleQuery.data])

  const rankingsQuery = useQuery({
    queryKey: ['nrfi-rankings', date],
    queryFn:  () => fetchNrfiRankings(date, lineupMap),
    staleTime: 5 * 60_000,
  })

  const sorted = useMemo(() => {
    if (!rankingsQuery.data) return []
    return [...rankingsQuery.data].sort((a, b) =>
      bet === 'nrfi' ? b.nrfiScore - a.nrfiScore : b.yrfiScore - a.yrfiScore,
    )
  }, [rankingsQuery.data, bet])

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.heading}>NRFI / YRFI</h1>
          <p className={styles.sub}>First inning ranker</p>
        </div>

        <div className={styles.betToggle}>
          <button
            className={`${styles.betBtn} ${bet === 'nrfi' ? styles.betBtnNrfi : ''}`}
            onClick={() => setBet('nrfi')}
          >
            NRFI
          </button>
          <button
            className={`${styles.betBtn} ${bet === 'yrfi' ? styles.betBtnYrfi : ''}`}
            onClick={() => setBet('yrfi')}
          >
            YRFI
          </button>
        </div>
      </div>

      <DateNav
        date={date}
        onPrev={() => setDate(d => format(subDays(parseISO(d), 1), 'yyyy-MM-dd'))}
        onNext={() => setDate(d => format(addDays(parseISO(d), 1), 'yyyy-MM-dd'))}
      />

      {rankingsQuery.isLoading && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>Loading rankings…</p>
          <p className={styles.stateDetail}>Fetching pitcher splits, lineup matchups &amp; trends</p>
        </div>
      )}

      {rankingsQuery.isError && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>Failed to load rankings</p>
          <p className={styles.stateDetail}>Check your connection and try again</p>
        </div>
      )}

      {!rankingsQuery.isLoading && !rankingsQuery.isError && sorted.length === 0 && (
        <div className={styles.stateCard}>
          <p className={styles.stateMsg}>No games scheduled</p>
        </div>
      )}

      {sorted.length > 0 && (
        <div className={styles.list}>
          {sorted.map((r, i) => (
            <NrfiCard key={r.gamePk} ranking={r} rank={i + 1} bet={bet} game={gameMap.get(r.gamePk)} />
          ))}
        </div>
      )}

      {sorted.length > 0 && (
        <p className={styles.footer}>
          Scores combine pitcher splits · lineup matchups · team trends · park &amp; weather context
        </p>
      )}
    </div>
  )
}

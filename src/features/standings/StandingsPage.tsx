import { useQuery } from '@tanstack/react-query'
import { getStandings } from '@/api/mlb/endpoints/standings'
import type { TeamStandingRecord } from '@/api/mlb/types'
import styles from './StandingsPage.module.css'

export default function StandingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['standings'],
    queryFn: () => getStandings(),
    staleTime: 60_000,
  })

  if (isLoading) return <p className={styles.message}>Loading standings…</p>
  if (error) return <p className={styles.error}>Failed to load standings.</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Standings</h1>
      <div className={styles.columns}>
        {data?.records.map((record) => (
          <div key={`${record.league.id}-${record.division.id}`} className={styles.division}>
            <h2 className={styles.divisionName}>{record.division.name}</h2>
            <StandingsTable teams={record.teamRecords} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StandingsTable({ teams }: { teams: TeamStandingRecord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.teamCol}>Team</th>
          <th>W</th>
          <th>L</th>
          <th>PCT</th>
          <th>GB</th>
          <th className={styles.streak}>Strk</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((tr) => (
          <tr key={tr.team.id}>
            <td className={styles.teamCol}>{tr.team.name}</td>
            <td>{tr.leagueRecord.wins}</td>
            <td>{tr.leagueRecord.losses}</td>
            <td>{tr.winningPercentage}</td>
            <td>{tr.gamesBack}</td>
            <td className={styles.streak}>{tr.streak.streakCode}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

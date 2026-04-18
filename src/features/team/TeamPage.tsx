import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getTeam, getTeamRoster } from '@/api/mlb/endpoints/teams'
import styles from './TeamPage.module.css'

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>()
  const id = Number(teamId)

  const teamQuery = useQuery({
    queryKey: ['team', id],
    queryFn: () => getTeam(id),
    enabled: !!id,
  })

  const rosterQuery = useQuery({
    queryKey: ['team-roster', id],
    queryFn: () => getTeamRoster(id),
    enabled: !!id,
  })

  if (teamQuery.isLoading) return <p className={styles.message}>Loading team…</p>
  if (teamQuery.error) return <p className={styles.error}>Team not found.</p>

  const team = (teamQuery.data as { teams: Array<{ name: string; locationName: string; division?: { name: string }; league?: { name: string } }> })?.teams?.[0]

  return (
    <div className={styles.page}>
      <h1 className={styles.name}>{team?.name}</h1>
      {team?.division && <p className={styles.meta}>{team.league?.name} · {team.division.name}</p>}

      {rosterQuery.isLoading && <p className={styles.message}>Loading roster…</p>}
      {!rosterQuery.isLoading && (
        <div className={styles.section}>
          <h2 className={styles.sectionHeading}>Active Roster</h2>
          <pre className={styles.raw}>{JSON.stringify(rosterQuery.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

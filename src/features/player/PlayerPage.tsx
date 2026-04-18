import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getPerson } from '@/api/mlb/endpoints/people'
import styles from './PlayerPage.module.css'

export default function PlayerPage() {
  const { playerId } = useParams<{ playerId: string }>()

  const { data, isLoading, error } = useQuery({
    queryKey: ['player', playerId],
    queryFn: () => getPerson(Number(playerId)),
    enabled: !!playerId,
  })

  const player = data?.people?.[0]

  if (isLoading) return <p className={styles.message}>Loading player…</p>
  if (error || !player) return <p className={styles.error}>Player not found.</p>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.name}>{player.fullName}</h1>
          <p className={styles.meta}>
            #{player.primaryNumber} · {player.primaryPosition?.name}
            {player.currentTeam ? ` · ${player.currentTeam.name}` : ''}
          </p>
        </div>
      </div>

      <dl className={styles.bio}>
        {player.birthDate && <><dt>Born</dt><dd>{player.birthDate}</dd></>}
        {player.height && <><dt>Height</dt><dd>{player.height}</dd></>}
        {player.weight && <><dt>Weight</dt><dd>{player.weight} lbs</dd></>}
        {player.batSide && <><dt>Bats</dt><dd>{player.batSide.description}</dd></>}
        {player.pitchHand && <><dt>Throws</dt><dd>{player.pitchHand.description}</dd></>}
        {player.mlbDebutDate && <><dt>MLB Debut</dt><dd>{player.mlbDebutDate}</dd></>}
      </dl>
    </div>
  )
}

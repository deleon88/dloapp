import { getTeamMeta } from '@/data/teams'
import styles from './UserAvatar.module.css'

/**
 * The user's initial on their favorite team's colors (primary fill, secondary
 * ring). Without a favorite team, the app's neutral blue.
 */
export default function UserAvatar({ name, teamId, size = 26 }: {
  name: string
  teamId: number | null | undefined
  size?: number
}) {
  const team = teamId != null ? getTeamMeta(teamId) : undefined
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.42),
    ...(team ? { background: team.color, borderColor: team.color2 } : {}),
  }
  return (
    <span className={`${styles.avatar} ${team ? styles.team : ''}`} style={style} aria-hidden="true">
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

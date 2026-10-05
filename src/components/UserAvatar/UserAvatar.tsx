import { getTeamMeta } from '@/data/teams'
import styles from './UserAvatar.module.css'

const luminance = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [16, 8, 0]
    .map(s => { const c = ((n >> s) & 255) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
}

/**
 * The team's secondary color, unless it barely shows on the primary (contrast
 * under 2:1, e.g. Marlins red on blue) — then white so the initial stays legible.
 */
function initialColor(primary: string, secondary: string): string {
  const [hi, lo] = [luminance(primary), luminance(secondary)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05) >= 2 ? secondary : '#fff'
}

/**
 * The user's initial on their favorite team's colors (primary fill, initial in
 * the secondary color). Without a favorite team, the app's neutral blue.
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
    ...(team ? { background: team.color, color: initialColor(team.color, team.color2) } : {}),
  }
  return (
    <span className={`${styles.avatar} ${team ? styles.team : ''}`} style={style} aria-hidden="true">
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { votingEnabled } from '@/lib/features'
import { useT } from '@/i18n/useT'
import UserAvatar from '@/components/UserAvatar/UserAvatar'
import { leaguePath, useLeague } from '@/utils/useLeague'
import styles from './MainNav.module.css'

/**
 * The app's sections: a bar at the bottom on phones (in thumb's reach), a rail
 * on the left on wide screens. "You" opens the account panel (signed out: the
 * sign-in), so the header only carries the brand and the league.
 */
export default function MainNav({ accountOpen, onAccount }: { accountOpen: boolean; onAccount: () => void }) {
  const t = useT()
  const league = useLeague()
  const { loading, session, profile, openAuth } = useAuthStore()
  const ranking = !!supabase && votingEnabled

  const link = ({ isActive }: { isActive: boolean }) => `${styles.item} ${isActive && !accountOpen ? styles.on : ''}`
  const items = (
    <>
      <NavLink to={leaguePath(league.key, 'games')} className={link}><GamesIcon /><span>{t('games')}</span></NavLink>
      <NavLink to={leaguePath(league.key, 'stats')} className={link}><StatsIcon /><span>{t('statsNav')}</span></NavLink>
      {ranking && <NavLink to={leaguePath(league.key, 'ranking')} className={link}><TrophyIcon /><span>{t('rankingsNav')}</span></NavLink>}
      {/* Hidden without Supabase and while the session loads (no flicker) */}
      {supabase && !loading && (
        <button type="button" className={`${styles.item} ${accountOpen ? styles.on : ''}`}
          onClick={session ? onAccount : () => openAuth('login')}
          aria-haspopup="dialog" aria-expanded={session ? accountOpen : undefined}
          aria-label={session ? t('profileTitle') : t('signIn')}>
          {session
            ? <UserAvatar name={profile?.username ?? session.user.email ?? '?'} teamId={profile?.favorite_team_id} size={22} />
            : <UserIcon />}
          <span>{t('you')}</span>
        </button>
      )}
    </>
  )

  return (
    <nav className={styles.nav} aria-label="Dloapp" style={{ '--n': 2 + (ranking ? 1 : 0) + (supabase ? 1 : 0) } as React.CSSProperties}>
      {items}
    </nav>
  )
}

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const GamesIcon = () => <Icon><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>
const StatsIcon = () => <Icon><path d="M5 20V10M12 20V4M19 20v-7" /></Icon>
const TrophyIcon = () => <Icon><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" /></Icon>
const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></Icon>

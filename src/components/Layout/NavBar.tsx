import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { votingEnabled } from '@/lib/features'
import { useT } from '@/i18n/useT'
import UserAvatar from '@/components/UserAvatar/UserAvatar'
import styles from './NavBar.module.css'

export default function NavBar() {
  const { loading, session, profile, openAuth } = useAuthStore()
  const t = useT()

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          <span className={styles.brandName}>Dloapp</span>
        </NavLink>

        <ul className={styles.links}>
          <li>
            <NavLink
              to="/schedule"
              className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
            >
              {t('games')}
            </NavLink>
          </li>
          {votingEnabled && (
            <li>
              <NavLink
                to="/rankings"
                className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
              >
                {t('rankingsNav')}
              </NavLink>
            </li>
          )}
        </ul>

        {/* The language pill lives on the profile page; without an account the
            language follows the browser (see langStore). */}
        {/* Sin el cliente de Supabase configurado no se muestra; mientras carga la sesión, tampoco (evita el parpadeo). */}
        {supabase && !loading && (
          session ? (
            // Con sesión: la inicial del usuario, con los colores de su equipo favorito.
            <NavLink to="/profile" className={styles.accountLink}
              aria-label={t('profileTitle')} title={profile?.username ?? session.user.email}>
              <UserAvatar name={profile?.username ?? session.user.email ?? '?'} teamId={profile?.favorite_team_id} />
            </NavLink>
          ) : (
            <button type="button" onClick={() => openAuth('login')} className={styles.accountBtn}
              aria-label={t('signIn')} title={t('signIn')}>
              <UserIcon />
            </button>
          )
        )}
      </nav>
    </header>
  )
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  )
}

import { NavLink } from 'react-router-dom'
import { useLangStore } from '@/stores/langStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { useT } from '@/i18n/useT'
import styles from './NavBar.module.css'

export default function NavBar() {
  const { lang, setLang } = useLangStore()
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
        </ul>

        <div className={styles.langToggle}>
          <button
            className={`${styles.langBtn} ${lang === 'en' ? styles.langBtnActive : ''}`}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            className={`${styles.langBtn} ${lang === 'es' ? styles.langBtnActive : ''}`}
            onClick={() => setLang('es')}
          >
            ES
          </button>
        </div>

        {/* Sin el cliente de Supabase configurado no se muestra; mientras carga la sesión, tampoco (evita el parpadeo). */}
        {supabase && !loading && (
          session ? (
            // Con sesión: el mismo cuadro, con la inicial del usuario.
            <NavLink to="/profile" className={`${styles.accountBtn} ${styles.accountBtnSignedIn}`}
              aria-label={t('profileTitle')} title={profile?.username ?? session.user.email}>
              {(profile?.username ?? session.user.email ?? '?').charAt(0).toUpperCase()}
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

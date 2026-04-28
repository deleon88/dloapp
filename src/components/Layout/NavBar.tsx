import { NavLink, useLocation } from 'react-router-dom'
import { useLangStore } from '@/stores/langStore'
import { useT } from '@/i18n/useT'
import styles from './NavBar.module.css'

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export default function NavBar() {
  const { pathname } = useLocation()
  const isLmb = pathname.startsWith('/lmb')
  const { lang, setLang } = useLangStore()
  const t = useT()

  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          <span className={styles.brandName}>DloPicks</span>
        </NavLink>

        <div className={styles.leagueToggle}>
          <NavLink
            to="/schedule"
            className={`${styles.leagueBtn} ${!isLmb ? styles.leagueBtnActive : ''}`}
          >
            MLB
          </NavLink>
          <span className={`${styles.leagueBtn} ${styles.leagueBtnLocked}`}>
            LMB
            <span className={styles.navLockBadge}><LockIcon /></span>
          </span>
        </div>

        <ul className={styles.links}>
          {!isLmb && (
            <>
              <li>
                <NavLink
                  to="/schedule"
                  className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
                >
                  {t('games')}
                </NavLink>
              </li>
            </>
          )}
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
      </nav>
    </header>
  )
}

import { NavLink } from 'react-router-dom'
import { useLangStore } from '@/stores/langStore'
import { useT } from '@/i18n/useT'
import styles from './NavBar.module.css'

export default function NavBar() {
  const { lang, setLang } = useLangStore()
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
      </nav>
    </header>
  )
}

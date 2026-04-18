import { NavLink, useLocation } from 'react-router-dom'
import styles from './NavBar.module.css'

export default function NavBar() {
  const { pathname } = useLocation()
  const isLmb = pathname.startsWith('/lmb')

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
          <NavLink
            to="/lmb"
            className={`${styles.leagueBtn} ${isLmb ? styles.leagueBtnActive : ''}`}
          >
            LMB
          </NavLink>
        </div>

        <ul className={styles.links}>
          {!isLmb && (
            <>
              <li>
                <NavLink
                  to="/schedule"
                  className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
                >
                  Games
                </NavLink>
              </li>
              <li>
                <NavLink
                  to="/standings"
                  className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
                >
                  Standings
                </NavLink>
              </li>
            </>
          )}
          {isLmb && (
            <li>
              <NavLink
                to="/lmb"
                className={({ isActive }) => [styles.link, isActive ? styles.linkActive : ''].join(' ')}
              >
                Games
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
    </header>
  )
}

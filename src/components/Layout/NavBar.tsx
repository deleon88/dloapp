import { NavLink } from 'react-router-dom'
import LeagueSwitcher from './LeagueSwitcher'
import styles from './NavBar.module.css'

/**
 * The header: the brand and the league. The sections and the account live in
 * MainNav (bottom bar / rail) and AccountPanel.
 */
export default function NavBar() {
  return (
    <header className={styles.header}>
      <nav className={styles.nav}>
        <NavLink to="/" className={styles.brand}>
          <span className={styles.brandName}>Dloapp</span>
        </NavLink>
        <LeagueSwitcher />
      </nav>
    </header>
  )
}

import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import AuthModal from '@/features/auth/AuthModal'
import { supabase } from '@/lib/supabase'
import { useTeamsVersion } from '@/data/teams'
import { loadTeams } from '@/data/loadTeams'
import NavBar from './NavBar'
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary'
import styles from './Layout.module.css'

// Pantallas del flujo de cuenta: desde aquí no se redirige a ningún lado.
const AUTH_PATHS = ['/profile', '/auth/callback']

export default function Layout() {
  const init = useAuthStore(s => s.init)
  const profile = useAuthStore(s => s.profile)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => init(), [init])

  // Team colors / parks from the database. If they differ from the bundled
  // copy, the page re-renders once with them (keyed on the version).
  const teamsVersion = useTeamsVersion(s => s.version)
  useEffect(() => { void loadTeams() }, [])

  useEffect(() => {
    if (AUTH_PATHS.includes(location.pathname)) return
    // Cuenta nueva (Google): falta elegir nombre de usuario.
    if (profile && profile.username == null) navigate('/profile', { replace: true })
  }, [profile, location.pathname, navigate])

  return (
    <div className={styles.root}>
      <NavBar />
      <main className={styles.main} key={teamsVersion}>
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      {supabase && <AuthModal />}
    </div>
  )
}

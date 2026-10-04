import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import AuthModal from '@/features/auth/AuthModal'
import NavBar from './NavBar'
import styles from './Layout.module.css'

// Pantallas del flujo de cuenta: desde aquí no se redirige a ningún lado.
const AUTH_PATHS = ['/profile', '/reset-password', '/auth/callback']

export default function Layout() {
  const init = useAuthStore(s => s.init)
  const { profile, recovering } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => init(), [init])

  useEffect(() => {
    if (AUTH_PATHS.includes(location.pathname)) return
    // Llegó con el enlace de recuperar contraseña: primero elige una nueva.
    if (recovering) navigate('/reset-password', { replace: true })
    // Cuenta nueva (sobre todo con Google/Apple): falta elegir nombre de usuario.
    else if (profile && profile.username == null) navigate('/profile', { replace: true })
  }, [profile, recovering, location.pathname, navigate])

  return (
    <div className={styles.root}>
      <NavBar />
      <main className={styles.main}>
        <Outlet />
      </main>
      <AuthModal />
    </div>
  )
}

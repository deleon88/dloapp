import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n/useT'
import { takeReturnTo } from './authShared'
import styles from './Auth.module.css'

const TIMEOUT_MS = 10_000

/**
 * Destino de los enlaces de confirmación de email y de Google/Apple. El cliente
 * de Supabase lee la sesión de la URL solo; aquí esperamos a que aparezca y
 * mandamos al usuario a completar su perfil o de vuelta a donde estaba.
 */
export default function AuthCallbackPage() {
  const t = useT()
  const navigate = useNavigate()
  const { loading, session, profile } = useAuthStore()
  // Error que devuelve el proveedor en la URL (enlace expirado, acceso cancelado…).
  const [failed, setFailed] = useState(() => /error/.test(window.location.hash + window.location.search))

  useEffect(() => {
    if (failed || loading || !session || !profile) return
    navigate(profile.username ? takeReturnTo() : '/profile', { replace: true })
  }, [failed, loading, session, profile, navigate])

  useEffect(() => {
    const id = setTimeout(() => setFailed(f => f || !useAuthStore.getState().session), TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {failed ? (
          <>
            <p className={styles.error}>{t('genericAuthError')}</p>
            <Link to="/login" replace className={styles.secondaryBtn}>{t('signIn')}</Link>
          </>
        ) : (
          <p className={styles.subtitle}>{t('signingIn')}</p>
        )}
      </div>
    </div>
  )
}

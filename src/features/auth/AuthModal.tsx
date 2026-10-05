import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore, type AuthView } from '@/stores/authStore'
import { useT, type TKey } from '@/i18n/useT'
import { ProviderButtons } from './authShared'
import styles from './Auth.module.css'

/**
 * Sign in as a modal over the current page — Google only for now (a Google
 * sign-in creates the account the first time). A bottom sheet on phones, a
 * centered card on wider screens. Opened from the nav bar, the locked filters
 * or the vote buttons (useAuthStore.openAuth); closed with ✕, Escape, the
 * backdrop, or automatically once a session starts.
 */
export default function AuthModal() {
  const { authView, closeAuth } = useAuthStore()
  const location = useLocation()
  const t = useT()
  const [error, setError] = useState<TKey | null>(null)

  // Where to come back after Google.
  const returnTo = location.pathname + location.search

  useEffect(() => {
    if (!authView) return
    setError(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAuth() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no scrolling the page behind the sheet
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [authView, closeAuth])

  if (!authView) return null

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) closeAuth() }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={styles.sheetHeader}>
          <h2 id="auth-title" className={styles.title}>{t('signIn')}</h2>
          <button type="button" className={styles.closeBtn} onClick={closeAuth} aria-label={t('close')}>✕</button>
        </div>
        <p className={styles.subtitle}>{t('signInPitch')}</p>
        <ProviderButtons t={t} onError={setError} returnTo={returnTo} />
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        <p className={styles.hint}>{t('googleCreatesAccount')}</p>
      </div>
    </div>
  )
}

/** Old /login, /signup and /forgot-password links: open the modal over the games page. */
export function OpenAuthRoute({ view }: { view: AuthView }) {
  const openAuth = useAuthStore(s => s.openAuth)
  useEffect(() => { openAuth(view) }, [openAuth, view])
  return <Navigate to="/schedule" replace />
}

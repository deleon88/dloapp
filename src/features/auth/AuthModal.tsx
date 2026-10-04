import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase, authRedirectUrl } from '@/lib/supabase'
import { useAuthStore, type AuthView } from '@/stores/authStore'
import { useT, type TKey } from '@/i18n/useT'
import { MIN_PASSWORD, ProviderButtons, authErrorKey, rememberReturnTo } from './authShared'
import styles from './Auth.module.css'

/**
 * Log in / sign up / forgot password as a modal over the current page: a
 * bottom sheet on phones, a centered card on wider screens. Opened from the
 * nav bar (useAuthStore.openAuth) and closed with ✕, Escape, the backdrop, or
 * automatically once a session starts.
 */
export default function AuthModal() {
  const { authView, openAuth, closeAuth } = useAuthStore()
  const location = useLocation()
  const t = useT()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Where to come back after leaving the app (Google/Apple, email links).
  const returnTo = location.pathname + location.search

  useEffect(() => {
    if (!authView) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAuth() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no scrolling the page behind the sheet
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [authView, closeAuth])

  // Focus the first field whenever the view changes.
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [authView])

  if (!authView) return null

  const titleKey: TKey = authView === 'signup' ? 'signUp' : authView === 'forgot' ? 'resetPasswordTitle' : 'signIn'

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) closeAuth() }}>
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={styles.sheetHeader}>
          <h2 id="auth-title" className={styles.title}>{t(titleKey)}</h2>
          <button type="button" className={styles.closeBtn} onClick={closeAuth} aria-label="Close">✕</button>
        </div>
        {authView === 'login' && <LoginView t={t} returnTo={returnTo} go={openAuth} />}
        {authView === 'signup' && <SignupView t={t} returnTo={returnTo} go={openAuth} />}
        {authView === 'forgot' && <ForgotView t={t} go={openAuth} />}
      </div>
    </div>
  )
}

interface ViewProps {
  t: (k: TKey) => string
  go: (view: AuthView) => void
}

function LoginView({ t, returnTo, go }: ViewProps & { returnTo: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return setError('authUnavailable')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(authErrorKey(error))
    // On success the store closes the modal when the session arrives.
  }

  return (
    <>
      <ProviderButtons t={t} onError={setError} returnTo={returnTo} />
      <div className={styles.divider}>{t('orDivider')}</div>
      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>{t('email')}</span>
          <input className={styles.input} type="email" autoComplete="email" required
            value={email} onChange={e => { setEmail(e.target.value); setError(null) }} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('password')}</span>
          <input className={styles.input} type="password" autoComplete="current-password" required
            value={password} onChange={e => { setPassword(e.target.value); setError(null) }} />
        </label>
        <button type="button" className={styles.inlineLink} onClick={() => go('forgot')}>{t('forgotPassword')}</button>
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        <button className={styles.primaryBtn} type="submit" disabled={busy || !email || !password}>
          {t('signIn')}
        </button>
      </form>
      <p className={styles.footer}>
        {t('noAccount')} <button type="button" className={styles.link} onClick={() => go('signup')}>{t('signUp')}</button>
      </p>
    </>
  )
}

function SignupView({ t, returnTo, go }: ViewProps & { returnTo: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return setError('authUnavailable')
    if (password.length < MIN_PASSWORD) return setError('passwordTooShort')
    setBusy(true)
    setError(null)
    rememberReturnTo(returnTo)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: authRedirectUrl() },
    })
    setBusy(false)
    if (error) return setError(authErrorKey(error))
    // With email confirmation on, Supabase answers with no identities when the
    // address is already registered (so it doesn't reveal which emails exist).
    if (data.user && data.user.identities?.length === 0) return setError('emailTaken')
    setSent(true)
  }

  if (sent) {
    return (
      <>
        <p className={styles.subtitle}><strong>{t('checkEmailTitle')}.</strong> {t('checkEmailSignup')}</p>
        <button type="button" className={styles.secondaryBtn} onClick={() => go('login')}>{t('signIn')}</button>
      </>
    )
  }

  return (
    <>
      <ProviderButtons t={t} onError={setError} returnTo={returnTo} />
      <div className={styles.divider}>{t('orDivider')}</div>
      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>{t('email')}</span>
          <input className={styles.input} type="email" autoComplete="email" required
            value={email} onChange={e => { setEmail(e.target.value); setError(null) }} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('password')}</span>
          <input className={styles.input} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD}
            aria-invalid={error === 'passwordTooShort'}
            value={password} onChange={e => { setPassword(e.target.value); setError(null) }} />
          <span className={styles.hint}>{t('passwordTooShort')}</span>
        </label>
        {error && <p className={styles.error} role="alert">{t(error)}</p>}
        <button className={styles.primaryBtn} type="submit" disabled={busy || !email || !password}>
          {t('signUp')}
        </button>
      </form>
      <p className={styles.footer}>
        {t('haveAccount')} <button type="button" className={styles.link} onClick={() => go('login')}>{t('signIn')}</button>
      </p>
    </>
  )
}

function ForgotView({ t, go }: ViewProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return setError('authUnavailable')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: authRedirectUrl('/reset-password'),
    })
    setBusy(false)
    // Same message whether or not the account exists, so emails can't be probed.
    if (error) return setError(authErrorKey(error))
    setSent(true)
  }

  if (sent) {
    return (
      <>
        <p className={styles.subtitle}>{t('checkEmailReset')}</p>
        <button type="button" className={styles.secondaryBtn} onClick={() => go('login')}>{t('signIn')}</button>
      </>
    )
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.field}>
        <span className={styles.label}>{t('email')}</span>
        <input className={styles.input} type="email" autoComplete="email" required
          value={email} onChange={e => { setEmail(e.target.value); setError(null) }} />
      </label>
      {error && <p className={styles.error} role="alert">{t(error)}</p>}
      <button className={styles.primaryBtn} type="submit" disabled={busy || !email}>
        {t('sendResetLink')}
      </button>
      <button type="button" className={styles.footer} onClick={() => go('login')}>{t('signIn')}</button>
    </form>
  )
}

/** Old /login, /signup and /forgot-password links: open the modal over the games page. */
export function OpenAuthRoute({ view }: { view: AuthView }) {
  const openAuth = useAuthStore(s => s.openAuth)
  useEffect(() => { openAuth(view) }, [openAuth, view])
  return <Navigate to="/schedule" replace />
}

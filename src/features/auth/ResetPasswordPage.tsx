import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useT, type TKey } from '@/i18n/useT'
import { MIN_PASSWORD, authErrorKey } from './authShared'
import styles from './Auth.module.css'

/** Destino del enlace "recuperar contraseña": Supabase abre una sesión temporal con él. */
export default function ResetPasswordPage() {
  const t = useT()
  const navigate = useNavigate()
  const { loading, session } = useAuthStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return setError('authUnavailable')
    if (password.length < MIN_PASSWORD) return setError('passwordTooShort')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(authErrorKey(error))
    useAuthStore.setState({ recovering: false })
    navigate('/schedule', { replace: true })
  }

  if (loading) return <div className={styles.page}><p className={styles.subtitle}>{t('loading')}</p></div>

  // Sin sesión: el enlace expiró o ya se usó.
  if (!session) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('resetPasswordTitle')}</h1>
          <p className={styles.error}>{t('genericAuthError')}</p>
          <Link to="/forgot-password" replace className={styles.secondaryBtn}>{t('sendResetLink')}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('setNewPassword')}</h1>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <label className={styles.field}>
            <span className={styles.label}>{t('newPassword')}</span>
            <input className={styles.input} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD}
              aria-invalid={error === 'passwordTooShort'}
              value={password} onChange={e => { setPassword(e.target.value); setError(null) }} />
            <span className={styles.hint}>{t('passwordTooShort')}</span>
          </label>
          {error && <p className={styles.error} role="alert">{t(error)}</p>}
          <button className={styles.primaryBtn} type="submit" disabled={busy || !password}>
            {t('savePassword')}
          </button>
        </form>
      </div>
    </div>
  )
}

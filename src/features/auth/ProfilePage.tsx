import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { OpenAuthRoute } from './AuthModal'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { TEAMS } from '@/data/teams'
import { useT, type TKey } from '@/i18n/useT'
import { takeReturnTo } from './authShared'
import styles from './Auth.module.css'

const USERNAME = /^[A-Za-z0-9_]{3,20}$/

export default function ProfilePage() {
  const t = useT()
  const navigate = useNavigate()
  const { loading, session, profile, refreshProfile, signOut } = useAuthStore()

  const [username, setUsername] = useState('')
  const [teamId, setTeamId] = useState('')
  const [error, setError] = useState<TKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const completing = profile != null && profile.username == null
  const teams = useMemo(() => [...TEAMS].sort((a, b) => a.brief.localeCompare(b.brief)), [])

  useEffect(() => {
    if (!profile) return
    setUsername(profile.username ?? '')
    setTeamId(profile.favorite_team_id != null ? String(profile.favorite_team_id) : '')
  }, [profile])

  if (loading) return <div className={styles.page}><p className={styles.subtitle}>{t('loading')}</p></div>
  if (!session) return <OpenAuthRoute view="login" />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !session) return setError('authUnavailable')
    const name = username.trim()
    if (!USERNAME.test(name)) return setError('usernameInvalid')
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ username: name, favorite_team_id: teamId ? Number(teamId) : null })
      .eq('id', session.user.id)
    setBusy(false)
    if (error) {
      // 23505 = índice único (nombre en uso); 23514 = formato inválido.
      return setError(error.code === '23505' ? 'usernameTaken' : error.code === '23514' ? 'usernameInvalid' : 'genericAuthError')
    }
    await refreshProfile()
    if (completing) return navigate(takeReturnTo(), { replace: true })
    setSaved(true)
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('profileTitle')}</h1>
        <p className={styles.subtitle}>{completing ? t('completeProfileHint') : session.user.email}</p>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <label className={styles.field}>
            <span className={styles.label}>{t('username')}</span>
            <input className={styles.input} autoComplete="username" maxLength={20}
              aria-invalid={error === 'usernameInvalid' || error === 'usernameTaken'}
              value={username} onChange={e => { setUsername(e.target.value); setError(null); setSaved(false) }} />
            <span className={styles.hint}>{t('usernameHint')}</span>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('favoriteTeam')}</span>
            <select className={styles.select} value={teamId}
              onChange={e => { setTeamId(e.target.value); setSaved(false) }}>
              <option value="">{t('noFavoriteTeam')}</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name} {team.brief}</option>)}
            </select>
          </label>
          {error && <p className={styles.error} role="alert">{t(error)}</p>}
          {saved && <p className={styles.success} role="status">{t('profileSaved')}</p>}
          <button className={styles.primaryBtn} type="submit" disabled={busy || !username}>
            {t('saveProfile')}
          </button>
        </form>

        <button type="button" className={styles.secondaryBtn}
          onClick={async () => { await signOut(); navigate('/schedule', { replace: true }) }}>
          {t('signOut')}
        </button>
      </div>
    </div>
  )
}

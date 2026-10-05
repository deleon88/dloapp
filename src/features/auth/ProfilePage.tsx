import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { OpenAuthRoute } from './AuthModal'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import TeamField from './TeamPicker'
import PickHistory from './PickHistory'
import UserAvatar from '@/components/UserAvatar/UserAvatar'
import LangToggle from '@/components/LangToggle/LangToggle'
import { useT, type TKey } from '@/i18n/useT'
import { takeReturnTo } from './authShared'
import styles from './Auth.module.css'

const USERNAME = /^[A-Za-z0-9_]{3,20}$/

export default function ProfilePage() {
  const t = useT()
  const navigate = useNavigate()
  const { loading, session, profile, refreshProfile, signOut } = useAuthStore()

  const [username, setUsername] = useState('')
  const [teamId, setTeamId] = useState<number | null>(null)
  const [error, setError] = useState<TKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const completing = profile != null && profile.username == null

  useEffect(() => {
    if (!profile) return
    setUsername(profile.username ?? '')
    setTeamId(profile.favorite_team_id)
  }, [profile])

  if (loading) return <div className={styles.page}><p className={styles.subtitle}>{t('loading')}</p></div>
  if (!session) return <OpenAuthRoute view="login" />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !session) return setError('authUnavailable')
    const name = username.trim()
    if (completing && !USERNAME.test(name)) return setError('usernameInvalid')
    setBusy(true)
    setError(null)
    // The username is chosen once (the database rejects changes): after that, only the team.
    const { error } = await supabase
      .from('profiles')
      .update(completing ? { username: name, favorite_team_id: teamId } : { favorite_team_id: teamId })
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
        {completing ? (
          <>
            <h1 className={styles.title}>{t('profileTitle')}</h1>
            <p className={styles.subtitle}>{t('completeProfileHint')}</p>
          </>
        ) : (
          // Avatar on the chosen team's colors (updates as soon as a team is confirmed).
          <div className={styles.identity}>
            <UserAvatar name={profile?.username ?? '?'} teamId={teamId} size={52} />
            <div className={styles.identityText}>
              <h1 className={styles.title}>{profile?.username}</h1>
              <p className={styles.subtitle}>{session.user.email}</p>
            </div>
          </div>
        )}

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {completing && (
            <label className={styles.field}>
              <span className={styles.label}>{t('username')}</span>
              <input className={styles.input} autoComplete="username" maxLength={20}
                aria-invalid={error === 'usernameInvalid' || error === 'usernameTaken'}
                value={username} onChange={e => { setUsername(e.target.value); setError(null); setSaved(false) }} />
              <span className={styles.hint}>{t('usernameHint')} · {t('usernamePermanent')}</span>
            </label>
          )}
          <div className={styles.field}>
            <span className={styles.label}>{t('favoriteTeam')}</span>
            <TeamField value={teamId} onChange={id => { setTeamId(id); setSaved(false) }} />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>{t('language')}</span>
            <LangToggle />
          </div>
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

      {!completing && <PickHistory userId={session.user.id} />}
    </div>
  )
}

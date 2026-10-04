import type { AuthError } from '@supabase/supabase-js'
import { supabase, authRedirectUrl } from '@/lib/supabase'
import type { TKey } from '@/i18n/useT'
import styles from './Auth.module.css'

const RETURN_KEY = 'dlp-auth-return'
export const MIN_PASSWORD = 8

/** Remember where to go back after a login that leaves the app (OAuth, email links). */
export function rememberReturnTo(path: string | undefined): void {
  try { sessionStorage.setItem(RETURN_KEY, path && path.startsWith('/') ? path : '/schedule') } catch { /* ignore */ }
}

export function takeReturnTo(): string {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    if (path && path.startsWith('/') && !path.startsWith('//')) return path
  } catch { /* ignore */ }
  return '/schedule'
}

/** Supabase error → translated message. Never shows raw error text to the user. */
export function authErrorKey(error: AuthError | null | undefined): TKey {
  switch (error?.code) {
    case 'invalid_credentials':  return 'invalidCredentials'
    case 'email_not_confirmed':  return 'emailNotConfirmed'
    case 'user_already_exists':
    case 'email_exists':         return 'emailTaken'
    case 'weak_password':        return 'passwordTooShort'
    default:                     return 'genericAuthError'
  }
}

export async function signInWithProvider(provider: 'google' | 'apple', returnTo?: string): Promise<AuthError | null> {
  if (!supabase) return null
  rememberReturnTo(returnTo)
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirectUrl() },
  })
  return error
}

export function ProviderButtons({ t, onError, returnTo }: {
  t: (k: TKey) => string
  onError: (k: TKey) => void
  returnTo?: string
}) {
  const go = async (provider: 'google' | 'apple') => {
    const error = await signInWithProvider(provider, returnTo)
    if (error) onError(authErrorKey(error))
  }
  return (
    <>
      <button type="button" className={`${styles.providerBtn} ${styles.google}`} onClick={() => go('google')}>
        <GoogleIcon /> {t('continueWithGoogle')}
      </button>
      <button type="button" className={`${styles.providerBtn} ${styles.apple}`} onClick={() => go('apple')}>
        <AppleIcon /> {t('continueWithApple')}
      </button>
    </>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  )
}

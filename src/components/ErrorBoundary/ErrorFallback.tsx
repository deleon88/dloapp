import { useT } from '@/i18n/useT'
import styles from './ErrorBoundary.module.css'

export default function ErrorFallback() {
  const t = useT()
  return (
    <div className={styles.box} role="alert">
      <p className={styles.title}>{t('somethingBroke')}</p>
      <p className={styles.hint}>{t('somethingBrokeHint')}</p>
      <button type="button" className={styles.btn} onClick={() => window.location.reload()}>
        {t('reload')}
      </button>
    </div>
  )
}

import { useLangStore } from '@/stores/langStore'
import type { Lang } from '@/i18n/translations'
import styles from './LangToggle.module.css'

const LANGS: Array<{ id: Lang; label: string; name: string }> = [
  { id: 'es', label: 'ES', name: 'Español' },
  { id: 'en', label: 'EN', name: 'English' },
]

/** EN / ES pill. */
export default function LangToggle() {
  const { lang, setLang } = useLangStore()
  return (
    <div className={styles.toggle} role="group">
      {LANGS.map(l => (
        <button key={l.id} type="button" aria-pressed={lang === l.id} aria-label={l.name}
          className={`${styles.btn} ${lang === l.id ? styles.active : ''}`}
          onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  )
}

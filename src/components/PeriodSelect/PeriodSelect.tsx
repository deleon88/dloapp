import { useState, useRef, useEffect } from 'react'
import { PERIOD_OPTIONS, periodLabel, type StatPeriod } from '@/utils/period'
import { useT } from '@/i18n/useT'
import { useAuthStore } from '@/stores/authStore'
import styles from './PeriodSelect.module.css'

interface Props {
  value: StatPeriod
  onChange: (v: StatPeriod) => void
  /** Not signed in: shows the full season with a lock and asks to log in. */
  locked?: boolean
}

// Todos los periodos están disponibles. Para reservar alguno a usuarios de pago,
// basta con quitarlo de esta lista: se muestra con candado y no se puede elegir.
const FREE_PERIODS: StatPeriod[] = PERIOD_OPTIONS.map(o => o.value)

export default function PeriodSelect({ value, onChange, locked = false }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const t = useT()
  const openAuth = useAuthStore(s => s.openAuth)

  const selectedLabel = periodLabel(value, t)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => (locked ? openAuth('login') : setOpen((o) => !o))}
        aria-haspopup={locked ? 'dialog' : 'listbox'}
        aria-expanded={open}
        title={locked ? t('filtersNeedAccount') : undefined}
      >
        <span>{selectedLabel}</span>
        {locked ? <LockIcon /> : (
          <svg
            className={[styles.chevron, open ? styles.chevronOpen : ''].join(' ')}
            width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
          >
            <path d="M8 11L3 6h10z" />
          </svg>
        )}
      </button>

      {open && (
        <ul className={styles.dropdown} role="listbox">
          {PERIOD_OPTIONS.map(({ value: v }) => {
            const isFree = FREE_PERIODS.includes(v)
            const isSelected = v === value
            return (
              <li
                key={v}
                role="option"
                aria-selected={isSelected}
                aria-disabled={!isFree}
                className={[
                  styles.option,
                  isSelected ? styles.optionSelected : '',
                  !isFree ? styles.optionLocked : '',
                ].join(' ')}
                onClick={() => {
                  if (!isFree) return
                  onChange(v)
                  setOpen(false)
                }}
              >
                <span className={styles.optionLabel}>{periodLabel(v, t)}</span>
                {!isFree && (
                  <span className={styles.lockBadge}>
                    <LockIcon />
                  </span>
                )}
                {isSelected && isFree && <CheckIcon />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

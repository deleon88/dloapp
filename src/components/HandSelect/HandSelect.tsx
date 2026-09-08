import { useState, useRef, useEffect } from 'react'
import {
  HAND_VALUES, BATTER_HAND_VALUES, batterLabelKey, pitcherLabelKey,
  type HandFilters,
} from '@/utils/handFilter'
import { useT } from '@/i18n/useT'
import periodStyles from '@/components/PeriodSelect/PeriodSelect.module.css'
import styles from './HandSelect.module.css'

interface Props {
  value: HandFilters
  onChange: (v: HandFilters) => void
}

/**
 * Handedness split filter — two independent toggles under one button: batters
 * (All / vs LHP / vs RHP / vs Starter Hand, wired to wrcComputed.ts's already-
 * computed vsL/vsR — "vs Starter Hand" resolves per-batter to that game's
 * actual opposing starter instead of a fixed hand) and pitchers (All / vs LHB
 * / vs RHB, wired to pitcherHandSplitsCache.ts). Dropdown visuals reuse
 * PeriodSelect.module.css so both controls match; only the icon-only trigger
 * button gets its own styling here.
 */
export default function HandSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isActive = value.batter !== 'all' || value.pitcher !== 'all'

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={[styles.trigger, isActive ? styles.triggerActive : ''].join(' ')}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('handFilterLabel')}
        title={t('handFilterLabel')}
      >
        <FilterIcon />
        {isActive && <span className={styles.activeDot} />}
      </button>

      {open && (
        <ul className={periodStyles.dropdown} role="listbox">
          <li className={styles.sectionLabel}>{t('handGroupBatters')}</li>
          {BATTER_HAND_VALUES.map(v => (
            <HandOption
              key={`batter-${v}`}
              label={t(batterLabelKey(v))}
              selected={value.batter === v}
              onSelect={() => onChange({ ...value, batter: v })}
            />
          ))}

          <li className={styles.divider} />

          <li className={styles.sectionLabel}>{t('handGroupPitchers')}</li>
          {HAND_VALUES.map(v => (
            <HandOption
              key={`pitcher-${v}`}
              label={t(pitcherLabelKey(v))}
              selected={value.pitcher === v}
              onSelect={() => onChange({ ...value, pitcher: v })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function HandOption({ label, selected, locked, onSelect }: {
  label: string
  selected: boolean
  locked?: boolean
  onSelect: () => void
}) {
  const t = useT()
  return (
    <li
      role="option"
      aria-selected={selected}
      aria-disabled={locked}
      className={[
        periodStyles.option,
        selected ? periodStyles.optionSelected : '',
        locked ? periodStyles.optionLocked : '',
      ].join(' ')}
      onClick={() => { if (!locked) onSelect() }}
    >
      <span className={periodStyles.optionLabel}>{label}</span>
      {locked && (
        <span className={periodStyles.lockBadge} title={t('handComingSoon')}>
          <LockIcon />
        </span>
      )}
      {selected && !locked && <CheckIcon />}
    </li>
  )
}

function FilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
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

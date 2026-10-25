import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT, type TKey } from '@/i18n/useT'
import styles from './StatGuide.module.css'

export interface GuideTab {
  id: string
  label: string
  desc: string
  /** The league average, shown big ("100", "4.00"). */
  average: string
  lowerIsBetter?: boolean
  /** Seven cut-offs, best to worst: excellent … awful. */
  tiers: [string, string, string, string, string, string, string]
}

const TIER_KEYS: TKey[] = ['tierExcellent', 'tierGreat', 'tierAbove', 'tierAverage', 'tierBelow', 'tierPoor', 'tierAwful']
// Same tier colors as the scale: green above average, neutral at the average, red below.
const TIER_COLORS = ['#34b27b', '#5cbf93', '#8ccdb0', 'rgba(255, 255, 255, 0.45)', '#d99aa5', '#cf7686', '#c4566a']

/**
 * How to read a card's stats: a tab per stat (or group) with what it measures,
 * the league average, a below → above scale and the tiers. A bottom sheet on
 * phones, a centered card on wider screens. Used by the schedule's bars guide
 * and the pitcher matchup card.
 *
 * Rendered into <body>: inside a card, the card's own rules (position, overflow,
 * stacking) would trap a fixed overlay in it.
 */
export default function StatGuide({ title, tabs, note, onClose }: {
  title: string; tabs: GuideTab[]
  /** Small print under the tiers: where the numbers come from. */
  note?: string
  onClose: () => void
}) {
  const t = useT()
  const [tab, setTab] = useState(tabs[0].id)
  const current = tabs.find(x => x.id === tab) ?? tabs[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no scrolling the page behind the sheet
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return createPortal(
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="stat-guide-title">
        <span className={styles.grabber} aria-hidden="true" />

        <div className={styles.header}>
          <h2 id="stat-guide-title" className={styles.title}>{title}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Two tabs side by side; more wrap in rows of three */}
        <div className={styles.tabs} role="tablist" style={{ gridTemplateColumns: `repeat(${Math.min(tabs.length, 3)}, 1fr)` }}>
          {tabs.map(x => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              className={`${styles.tab} ${tab === x.id ? styles.tabActive : ''}`}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className={styles.panel}>
          <p className={styles.desc}>{current.desc}</p>

          <div className={styles.average}>
            <span className={styles.averageNum}>{current.average}</span>
            <span className={styles.averageText}>
              {t('guideAverageIs')}<br />{t(current.lowerIsBetter ? 'guideLowerBetter' : 'guideHigherBetter')}
            </span>
          </div>

          <div className={styles.scale} aria-hidden="true">
            <div className={styles.scaleBar}><span className={styles.scaleMark} /></div>
            <div className={styles.scaleLabels}>
              <span>{t('guideScaleBelow')}</span>
              <span>{t('guideScaleAverage')}</span>
              <span>{t('guideScaleAbove')}</span>
            </div>
          </div>

          <ul className={styles.tiers}>
            {current.tiers.map((value, i) => (
              <li key={TIER_KEYS[i]} className={styles.tier}>
                <span className={styles.tierName}>
                  <span className={styles.dot} style={{ background: TIER_COLORS[i] }} />
                  {t(TIER_KEYS[i])}
                </span>
                <span className={styles.tierValue}>{value}</span>
              </li>
            ))}
          </ul>
          {note && <p className={styles.note}>{note}</p>}
        </div>

        <button type="button" className={styles.gotIt} onClick={onClose}>{t('guideGotIt')}</button>
      </div>
    </div>,
    document.body,
  )
}

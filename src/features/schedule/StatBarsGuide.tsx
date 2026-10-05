import { useEffect, useState } from 'react'
import { useT, type TKey } from '@/i18n/useT'
import styles from './StatBarsGuide.module.css'

type Tab = 'pitching' | 'offense'
type Tier = { key: TKey; value: string; color: string }

// Same tier colors as the scale: green above average, neutral at 100, red below.
const GOOD3 = '#34b27b', GOOD2 = '#5cbf93', GOOD1 = '#8ccdb0'
const AVG = 'rgba(255, 255, 255, 0.45)'
const BAD1 = '#d99aa5', BAD2 = '#cf7686', BAD3 = '#c4566a'

const TIERS: Record<Tab, Tier[]> = {
  pitching: [
    { key: 'tierExcellent', value: '≥ 130', color: GOOD3 },
    { key: 'tierGreat',     value: '≥ 120', color: GOOD2 },
    { key: 'tierAbove',     value: '≥ 110', color: GOOD1 },
    { key: 'tierAverage',   value: '100',   color: AVG },
    { key: 'tierBelow',     value: '≤ 90',  color: BAD1 },
    { key: 'tierPoor',      value: '≤ 85',  color: BAD2 },
    { key: 'tierAwful',     value: '≤ 75',  color: BAD3 },
  ],
  offense: [
    { key: 'tierExcellent', value: '≥ 160', color: GOOD3 },
    { key: 'tierGreat',     value: '≥ 140', color: GOOD2 },
    { key: 'tierAbove',     value: '≥ 115', color: GOOD1 },
    { key: 'tierAverage',   value: '100',   color: AVG },
    { key: 'tierBelow',     value: '≤ 80',  color: BAD1 },
    { key: 'tierPoor',      value: '≤ 75',  color: BAD2 },
    { key: 'tierAwful',     value: '≤ 60',  color: BAD3 },
  ],
}

const TABS: Array<{ id: Tab; label: TKey; desc: TKey }> = [
  { id: 'pitching', label: 'guideTabPitching', desc: 'fipPlusDesc' },
  { id: 'offense',  label: 'guideTabOffense',  desc: 'wrcPlusDesc' },
]

/**
 * How to read the schedule's stat bars (FIP+ for starters and bullpen, wRC+
 * for offense): a bottom sheet on phones, a centered card on wider screens.
 */
export default function StatBarsGuide({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [tab, setTab] = useState<Tab>('pitching')
  const current = TABS.find(x => x.id === tab)!

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

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="stat-guide-title">
        <span className={styles.grabber} aria-hidden="true" />

        <div className={styles.header}>
          <h2 id="stat-guide-title" className={styles.title}>{t('statBarsGuide')}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          {TABS.map(x => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              className={`${styles.tab} ${tab === x.id ? styles.tabActive : ''}`}
              onClick={() => setTab(x.id)}
            >
              {t(x.label)}
            </button>
          ))}
        </div>

        <div role="tabpanel" className={styles.panel}>
          <p className={styles.desc}>{t(current.desc)}</p>

          <div className={styles.average}>
            <span className={styles.averageNum}>100</span>
            <span className={styles.averageText}>
              {t('guideAverageIs')}<br />{t('guideHigherBetter')}
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
            {TIERS[tab].map(tier => (
              <li key={tier.key} className={styles.tier}>
                <span className={styles.tierName}>
                  <span className={styles.dot} style={{ background: tier.color }} />
                  {t(tier.key)}
                </span>
                <span className={styles.tierValue}>{tier.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <button type="button" className={styles.gotIt} onClick={onClose}>{t('guideGotIt')}</button>
      </div>
    </div>
  )
}

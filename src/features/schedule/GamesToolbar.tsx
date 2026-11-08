import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { leagueParams, type LeagueKey } from '@/data/leagues'
import { useT } from '@/i18n/useT'
import { useLangStore } from '@/stores/langStore'
import { useAuthStore } from '@/stores/authStore'
import { PERIOD_OPTIONS, periodLabel, type StatPeriod } from '@/utils/period'
import {
  BATTER_HAND_VALUES, DEFAULT_HAND_FILTERS, HAND_VALUES, batterLabelKey, pitcherLabelKey, type HandFilters,
} from '@/utils/handFilter'
import styles from './GamesToolbar.module.css'

const CAROUSEL_DAYS = 10   // either side of the day shown

interface Props {
  league: LeagueKey
  date: string
  today: string
  onDate: (d: string) => void
  period: StatPeriod
  onPeriod: (p: StatPeriod) => void
  hands: HandFilters
  onHands: (h: HandFilters) => void
  /** Signed out: filters ask to log in. */
  locked: boolean
  onGuide: () => void
}

const shift = (d: string, n: number) => format(addDays(parseISO(d), n), 'yyyy-MM-dd')

/**
 * The Games page's one line: the day (‹ arrows on both sides ›; the center opens
 * a carousel of days with their game counts, for the odd jump) and a Filters
 * button that says what's applied and opens the filters sheet.
 */
export default function GamesToolbar({ league, date, today, onDate, period, onPeriod, hands, onHands, locked, onGuide }: Props) {
  const t = useT()
  const lang = useLangStore(s => s.lang)
  const openAuth = useAuthStore(s => s.openAuth)
  const [daysOpen, setDaysOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const locale = lang === 'es' ? 'es-MX' : 'en-US'
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).formatToParts(new Date(`${d}T12:00:00Z`))
  const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find(p => p.type === type)?.value.replace('.', '') ?? ''

  // "Hoy" / "Ayer" / "Mañana", else the weekday; the date beside it ("dom 8 nov")
  const p = fmt(date, { weekday: 'short', day: 'numeric', month: 'short' })
  const wd = part(p, 'weekday'), day = part(p, 'day'), mon = part(p, 'month')
  const rel = date === today ? t('dayToday') : date === shift(today, -1) ? t('dayYesterday') : date === shift(today, 1) ? t('dayTomorrow') : null
  const title = rel ?? wd.charAt(0).toUpperCase() + wd.slice(1)
  const sub = lang === 'es' ? `${rel ? wd + ' ' : ''}${day} ${mon}` : `${rel ? wd + ' ' : ''}${mon} ${day}`

  // What the filters button says: the active ones, and how many
  const active = [
    period !== 'season' ? periodLabel(period, t) : null,
    hands.batter !== 'all' ? `${t('handShortBat')} ${t(batterLabelKey(hands.batter))}` : null,
    hands.pitcher !== 'all' ? `${t('handShortPit')} ${t(pitcherLabelKey(hands.pitcher))}` : null,
  ].filter((x): x is string => !!x)

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <div className={styles.day}>
          <button type="button" className={styles.arrow} onClick={() => onDate(shift(date, -1))} aria-label={t('previousDay')}>
            <Chevron dir="left" />
          </button>
          <button type="button" className={styles.center} onClick={() => setDaysOpen(o => !o)} aria-expanded={daysOpen}
            aria-label={`${title} ${sub} · ${t('pickDay')}`}>
            <b className={date === today ? styles.today : undefined}>{title}</b>
            <span>{sub}</span>
            <svg className={`${styles.caret} ${daysOpen ? styles.caretOpen : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
          </button>
          <button type="button" className={styles.arrow} onClick={() => onDate(shift(date, 1))} aria-label={t('nextDay')}>
            <Chevron dir="right" />
          </button>
        </div>

        <button type="button" className={`${styles.filters} ${active.length ? styles.filtersOn : ''}`}
          onClick={() => (locked ? openAuth('login') : setFiltersOpen(true))}
          aria-haspopup="dialog" title={locked ? t('filtersNeedAccount') : undefined}>
          <SlidersIcon />
          <span className={styles.filtersText}>{active.length ? active.join(' · ') : t('filtersTitle')}</span>
          {locked ? <LockIcon /> : active.length > 0 && <span className={styles.count}>{active.length}</span>}
        </button>
      </div>

      {daysOpen && (
        <DayCarousel league={league} date={date} today={today} locale={locale}
          onPick={d => { onDate(d); setDaysOpen(false) }} />
      )}

      {filtersOpen && createPortal(
        <FiltersSheet period={period} onPeriod={onPeriod} hands={hands} onHands={onHands}
          onGuide={() => { setFiltersOpen(false); onGuide() }} onClose={() => setFiltersOpen(false)} />,
        document.body,
      )}
    </div>
  )
}

/* ── Days carousel ─────────────────────────────────────────────────── */

function DayCarousel({ league, date, today, locale, onPick }: {
  league: LeagueKey; date: string; today: string; locale: string; onPick: (d: string) => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const from = shift(date, -CAROUSEL_DAYS), to = shift(date, CAROUSEL_DAYS)
  const days = Array.from({ length: CAROUSEL_DAYS * 2 + 1 }, (_, i) => shift(from, i))

  // Games per day over the window, from one schedule call
  const counts = useQuery({
    queryKey: ['day-counts', league, from, to],
    queryFn: async () => {
      const s = await getSchedule({ startDate: from, endDate: to, ...leagueParams(league) })
      const m = new Map<string, number>()
      for (const d of s.dates ?? []) m.set(d.date, d.games.filter(g => !['Postponed', 'Cancelled'].includes(g.status.detailedState)).length)
      return m
    },
    staleTime: 10 * 60_000,
  })

  // The day shown in the middle of the strip
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="date"]')
    const strip = ref.current
    if (el && strip) strip.scrollLeft = el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2
  }, [date])

  const label = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)).replace('.', '')

  return (
    <div className={styles.carousel} ref={ref} role="listbox" aria-label={t('pickDay')}>
      {days.map(d => {
        const n = counts.data?.get(d) ?? 0
        return (
          <button key={d} type="button" role="option" aria-selected={d === date} aria-current={d === date ? 'date' : undefined}
            className={`${styles.dayBtn} ${d === date ? styles.dayOn : ''} ${d === today ? styles.dayToday : ''} ${counts.data && !n ? styles.dayEmpty : ''}`}
            onClick={() => onPick(d)}>
            <small>{d === today ? t('dayToday') : label(d, { weekday: 'short' })}</small>
            <b>{label(d, { day: 'numeric' })}</b>
            <em>{counts.data ? (n ? t('gamesN').replace('{n}', String(n)) : '—') : '·'}</em>
          </button>
        )
      })}
    </div>
  )
}

/* ── Filters sheet ─────────────────────────────────────────────────── */

function FiltersSheet({ period, onPeriod, hands, onHands, onGuide, onClose }: {
  period: StatPeriod; onPeriod: (p: StatPeriod) => void
  hands: HandFilters; onHands: (h: HandFilters) => void
  onGuide: () => void; onClose: () => void
}) {
  const t = useT()

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose])

  const isDefault = period === 'season' && hands.batter === 'all' && hands.pitcher === 'all'

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <span className={styles.grabber} aria-hidden="true" />
        <div className={styles.sheetHead}>
          <h2 id="filters-title" className={styles.sheetTitle}>{t('filtersTitle')}</h2>
          <button type="button" className={styles.reset} disabled={isDefault}
            onClick={() => { onPeriod('season'); onHands(DEFAULT_HAND_FILTERS) }}>{t('filtersReset')}</button>
        </div>

        <div className={styles.group}>{t('filtersPeriod')}</div>
        <div className={styles.pills} role="radiogroup" aria-label={t('filtersPeriod')}>
          {PERIOD_OPTIONS.map(({ value }) => (
            <button key={value} type="button" role="radio" aria-checked={value === period}
              className={`${styles.pill} ${value === period ? styles.pillOn : ''}`} onClick={() => onPeriod(value)}>
              {periodLabel(value, t)}
            </button>
          ))}
        </div>

        <div className={styles.group}>{t('handGroupBatters')}</div>
        <div className={styles.pills} role="radiogroup" aria-label={t('handGroupBatters')}>
          {BATTER_HAND_VALUES.map(v => (
            <button key={v} type="button" role="radio" aria-checked={hands.batter === v}
              className={`${styles.pill} ${hands.batter === v ? styles.pillOn : ''}`} onClick={() => onHands({ ...hands, batter: v })}>
              {t(batterLabelKey(v))}
            </button>
          ))}
        </div>

        <div className={styles.group}>{t('handGroupPitchers')}</div>
        <div className={styles.pills} role="radiogroup" aria-label={t('handGroupPitchers')}>
          {HAND_VALUES.map(v => (
            <button key={v} type="button" role="radio" aria-checked={hands.pitcher === v}
              className={`${styles.pill} ${hands.pitcher === v ? styles.pillOn : ''}`} onClick={() => onHands({ ...hands, pitcher: v })}>
              {t(pitcherLabelKey(v))}
            </button>
          ))}
        </div>

        <button type="button" className={styles.guide} onClick={onGuide}>
          <span className={styles.guideQ} aria-hidden="true">?</span>{t('statBarsGuide')}
        </button>
        <button type="button" className={styles.done} onClick={onClose}>{t('filtersDone')}</button>
      </div>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────── */

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg className={styles.sliders} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className={styles.lock} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

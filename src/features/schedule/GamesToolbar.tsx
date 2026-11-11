import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { leagueParams, type LeagueKey } from '@/data/leagues'
import { useT } from '@/i18n/useT'
import { useLangStore } from '@/stores/langStore'
import type { StatPeriod } from '@/utils/period'
import type { HandFilters } from '@/utils/handFilter'
import PeriodSelect from '@/components/PeriodSelect/PeriodSelect'
import HandSelect from '@/components/HandSelect/HandSelect'
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
 * a carousel of days with their game counts, for the odd jump) and the same
 * filters as the game page: the period, the hands (funnel, a dot when set) and
 * the bars guide.
 */
export default function GamesToolbar({ league, date, today, onDate, period, onPeriod, hands, onHands, locked, onGuide }: Props) {
  const t = useT()
  const lang = useLangStore(s => s.lang)
  const [daysOpen, setDaysOpen] = useState(false)

  const locale = lang === 'es' ? 'es-MX' : 'en-US'
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: 'UTC' }).formatToParts(new Date(`${d}T12:00:00Z`))
  const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find(p => p.type === type)?.value.replace('.', '') ?? ''

  // "Hoy" / "Ayer" / "Mañana", else the weekday; the date beside it ("8 nov")
  const p = fmt(date, { weekday: 'short', day: 'numeric', month: 'short' })
  const wd = part(p, 'weekday'), day = part(p, 'day'), mon = part(p, 'month')
  const rel = date === today ? t('dayToday') : date === shift(today, -1) ? t('dayYesterday') : date === shift(today, 1) ? t('dayTomorrow') : null
  const title = rel ?? wd.charAt(0).toUpperCase() + wd.slice(1)
  // with Today / Yesterday / Tomorrow the weekday would repeat it: just the date
  const sub = lang === 'es' ? `${day} ${mon}` : `${mon} ${day}`

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

        <div className={styles.filters}>
          <PeriodSelect value={period} onChange={onPeriod} locked={locked} />
          <HandSelect value={hands} onChange={onHands} locked={locked} />
          <button type="button" className={styles.guideBtn} onClick={onGuide} aria-label={t('statBarsGuide')} title={t('statBarsGuide')}>?</button>
        </div>
      </div>

      {daysOpen && (
        <DayCarousel league={league} date={date} today={today} locale={locale}
          onPick={d => { onDate(d); setDaysOpen(false) }} />
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

/* ── Icons ─────────────────────────────────────────────────────────── */

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { inSeason, LEAGUES, LOCKED_LEAGUES, leagueParams, SPORTS, type LeagueInfo } from '@/data/leagues'
import { useT } from '@/i18n/useT'
import { useLangStore } from '@/stores/langStore'
import { mlbToday } from '@/utils/etDate'
import { leaguePath, useLeague, type LeaguePage } from '@/utils/useLeague'
import styles from './LeagueSwitcher.module.css'

const PAGES: LeaguePage[] = ['games', 'stats', 'ranking']

/**
 * The league, next to the brand as the app's title: its logo and name. Tapping
 * it brings up the leagues sheet (a bottom sheet on phones, a centered card on
 * wide screens): each league with its full name and how its day looks (games
 * today, none, offseason), grouped by sport; leagues on the way, locked.
 * Every page follows the league picked here.
 */
export default function LeagueSwitcher() {
  const league = useLeague()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const t = useT()
  const lang = useLangStore(s => s.lang)
  const today = mlbToday()

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [open])

  // Today's games of each league, once the sheet has been opened
  const counts = useQueries({
    queries: LEAGUES.map(l => ({
      queryKey: ['league-games-today', l.key, today],
      queryFn: async () => {
        const s = await getSchedule({ date: today, ...leagueParams(l.key) })
        return (s.dates?.[0]?.games ?? []).filter(g => !['Postponed', 'Cancelled'].includes(g.status.detailedState)).length
      },
      enabled: open,
      staleTime: 5 * 60_000,
    })),
  })

  // Same page in the new league (a game page goes to the new league's games)
  const pick = (next: LeagueInfo) => {
    setOpen(false)
    if (next.key === league.key) return
    const page = PAGES.find(p => pathname.split('/')[2] === p) ?? 'games'
    navigate(leaguePath(next.key, page))
  }

  const status = (l: LeagueInfo, i: number) => {
    const n = counts[i].data
    if (n) return { text: t(n === 1 ? 'leagueGameToday' : 'leagueGamesToday').replace('{n}', String(n)), live: true }
    if (!inSeason(l.key, today)) return { text: t('leagueOffseason'), live: false }
    if (n === 0) return { text: t('leagueNoGamesToday'), live: false }
    return { text: '', live: false }
  }

  // "dom 8 nov" / "Sun Nov 8": the parts only (Spanish's "8 de nov." drops its "de" and dot)
  const parts = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(`${today}T12:00:00Z`))
  const part = (type: string) => parts.find(p => p.type === type)?.value.replace('.', '') ?? ''
  const dateLabel = lang === 'es' ? `${part('weekday')} ${part('day')} ${part('month')}` : `${part('weekday')} ${part('month')} ${part('day')}`

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-expanded={open} aria-label={`${t('leagueSelect')}: ${league.name}`}>
        <img src={league.logo} alt="" width={22} height={22} />
        <span>{league.name}</span>
        <svg className={styles.caret} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>

      {open && createPortal(
        <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="league-sheet-title">
            <span className={styles.grabber} aria-hidden="true" />
            <div className={styles.head}>
              <h2 id="league-sheet-title" className={styles.title}>{t('leaguesTitle')}</h2>
              <span className={styles.date}>{dateLabel}</span>
            </div>
            {SPORTS.map(sport => (
              <div key={sport.key} role="radiogroup" aria-label={t(`sport_${sport.key}`)}>
                <div className={styles.sport}>{t(`sport_${sport.key}`)}</div>
                {LEAGUES.map((l, i) => {
                  if (l.sport !== sport.key) return null
                  const s = status(l, i), on = l.key === league.key
                  return (
                    <button key={l.key} type="button" role="radio" aria-checked={on}
                      className={`${styles.row} ${on ? styles.rowOn : ''}`} onClick={() => pick(l)}>
                      <span className={styles.tile}><img src={l.logo} alt="" /></span>
                      <span className={styles.names}>
                        <span className={styles.name}>{l.name}</span>
                        <span className={styles.full}>{l.fullName}</span>
                        {s.text && (
                          <span className={`${styles.status} ${s.live ? styles.statusLive : ''}`}>
                            {s.live && <i className={styles.dot} aria-hidden="true" />}{s.text}
                          </span>
                        )}
                      </span>
                      {on && (
                        <span className={styles.check} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        </span>
                      )}
                    </button>
                  )
                })}
                {/* On the way: shown, locked */}
                {LOCKED_LEAGUES.filter(l => l.sport === sport.key).map(l => (
                  <div key={l.name} className={`${styles.row} ${styles.rowLocked}`} aria-disabled="true">
                    <span className={styles.tile}><img src={l.logo} alt="" /></span>
                    <span className={styles.names}>
                      <span className={styles.name}>{l.name}</span>
                      <span className={styles.full}>{l.fullName}</span>
                    </span>
                    <span className={styles.lock} title={t('leagueLocked')} aria-label={t('leagueLocked')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { getSchedule } from '@/api/mlb/endpoints/schedule'
import { inSeason, LEAGUES, leagueParams, SPORTS, type LeagueInfo } from '@/data/leagues'
import { useT } from '@/i18n/useT'
import { mlbToday } from '@/utils/etDate'
import { leaguePath, useLeague, type LeaguePage } from '@/utils/useLeague'
import styles from './LeagueSwitcher.module.css'

const PAGES: LeaguePage[] = ['games', 'stats', 'ranking']

/**
 * The league chip of the nav bar: every page follows the league picked here.
 * The menu groups leagues by sport and says which have games today.
 */
export default function LeagueSwitcher() {
  const league = useLeague()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const t = useT()
  const today = mlbToday()

  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key) }
  }, [open])

  // Today's games of each league, once the menu has been opened
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
    if (n) return { text: t('leagueGamesToday').replace('{n}', String(n)), live: true }
    if (n === 0 && inSeason(l.key, today)) return { text: t('leagueNoGamesToday'), live: false }
    if (!inSeason(l.key, today)) return { text: t('leagueOffseason'), live: false }
    return { text: '', live: false }
  }

  return (
    <div className={styles.wrapper} ref={ref}>
      <button type="button" className={styles.chip} onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-label={`${t('leagueSelect')}: ${league.name}`}>
        <img src={league.logo} alt="" width={18} height={18} />
        <span>{league.name}</span>
        <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 11L3 6h10z" />
        </svg>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {SPORTS.map(sport => (
            <div key={sport.key} className={styles.sport}>
              <div className={styles.sportName}>{t(`sport_${sport.key}`)}</div>
              {LEAGUES.map((l, i) => l.sport !== sport.key ? null : (
                <button key={l.key} type="button" role="menuitemradio" aria-checked={l.key === league.key}
                  className={`${styles.item} ${l.key === league.key ? styles.itemActive : ''}`}
                  onClick={() => pick(l)}>
                  <img src={l.logo} alt="" width={26} height={26} />
                  <span className={styles.names}>
                    <span className={styles.name}>{l.name}</span>
                    <span className={styles.full}>{l.fullName}</span>
                  </span>
                  {(() => {
                    const s = status(l, i)
                    return <span className={`${styles.status} ${s.live ? styles.statusLive : ''}`}>{s.text}</span>
                  })()}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

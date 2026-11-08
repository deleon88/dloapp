import { useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { rankingEnabled, votingEnabled } from '@/lib/features'
import { useT } from '@/i18n/useT'
import { fetchPickHistory, fetchRankings, type RankingRow } from '@/api/votes'
import { capLogoUrl, getTeamMeta } from '@/data/teams'
import UserAvatar from '@/components/UserAvatar/UserAvatar'
import LangToggle from '@/components/LangToggle/LangToggle'
import { leaguePath, useLeague } from '@/utils/useLeague'
import styles from './AccountPanel.module.css'

/**
 * The signed-in user's panel, from the right: who they are (name in the cards'
 * TV style, on their favorite team's color), their picks record, where they
 * stand in this week's ranking of the league, and the account.
 * Rendered into <body>, so no page's stacking or overflow can trap it.
 */
export default function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const league = useLeague()
  const { session, profile, signOut } = useAuthStore()
  const team = profile?.favorite_team_id != null ? getTeamMeta(profile.favorite_team_id) : undefined
  const name = profile?.username ?? session?.user.email ?? ''

  const history = useQuery({
    queryKey: ['pick-history', session?.user.id],
    queryFn: fetchPickHistory,
    enabled: open && !!session && votingEnabled,
    staleTime: 60_000,
  })
  const ranking = useQuery({
    queryKey: ['rankings', 'week', league.key],
    queryFn: () => fetchRankings('week', league.key),
    enabled: open && rankingEnabled,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'   // no scrolling the page behind the panel
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!session) return null

  const s = history.data?.summary
  const rows = ranking.data?.rows ?? []
  const mine = rows.find(r => r.username === profile?.username)
  // the podium, and the user's row under it when they're further down
  const shown: RankingRow[] = [...rows.slice(0, 3), ...(mine && mine.rank > 3 ? [mine] : [])]

  return createPortal(
    <div className={`${styles.root} ${open ? styles.open : ''}`} aria-hidden={!open}>
      <div className={styles.scrim} onClick={onClose} />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={t('profileTitle')}
        style={team ? { '--team': team.color } as CSSProperties : undefined}>
        {/* Who: the cards' FIRST small / LAST big, on the favorite team's color */}
        <div className={styles.hero}>
          {team && <img className={styles.watermark} src={capLogoUrl(team.id)} alt="" />}
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('close')} tabIndex={open ? 0 : -1}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <UserAvatar name={name} teamId={profile?.favorite_team_id} size={44} />
          {team && <div className={styles.first}>{team.name} {team.brief}</div>}
          <div className={styles.last}>{name}</div>
          {s && (s.won + s.lost > 0) && (
            <div className={styles.chips}>
              <span className={styles.chip}>{s.won}-{s.lost}</span>
              {s.pct != null && <span className={styles.chip}>{t('accuracyPct').replace('{n}', String(Math.round(s.pct)))}</span>}
              {s.streak && s.streak.kind === 'won' && s.streak.n > 1 && (
                <span className={styles.chip}>{t('streakN').replace('{n}', String(s.streak.n))}</span>
              )}
            </div>
          )}
        </div>

        {rankingEnabled && (
          <section className={styles.stand} aria-label={t('rankingsNav')}>
            <div className={styles.standHead}>
              <b>{t('rankingsNav')} · {t('periodWeek').toLowerCase()}</b>
              <span>{league.name}</span>
            </div>
            {ranking.isLoading && <p className={styles.standNote}>…</p>}
            {!ranking.isLoading && shown.length === 0 && <p className={styles.standNote}>{t('noRankingYet')}</p>}
            {shown.map(r => (
              <div key={r.username} className={`${styles.lb} ${r.username === profile?.username ? styles.lbMe : ''}`}>
                <span className={styles.lbRank}>{r.rank}</span>
                <span className={styles.lbName}>{r.username}</span>
                <span className={styles.lbPct}>{Math.round(r.pct)}%</span>
              </div>
            ))}
            {!ranking.isLoading && rows.length > 0 && !mine && <p className={styles.standNote}>{t('notRankedYet')}</p>}
            <Link to={leaguePath(league.key, 'ranking')} className={styles.all} onClick={onClose} tabIndex={open ? 0 : -1}>
              {t('seeFullRanking')} ›
            </Link>
          </section>
        )}

        <div className={styles.sect}>{t('account')}</div>
        {votingEnabled && (
          <Link to="/profile#picks" className={styles.row} onClick={onClose} tabIndex={open ? 0 : -1}>
            <PicksIcon />{t('myPicks')}<Chevron />
          </Link>
        )}
        <Link to="/profile" className={styles.row} onClick={onClose} tabIndex={open ? 0 : -1}>
          <UserIcon />{t('editProfile')}<Chevron />
        </Link>
        <div className={styles.row}>
          <GlobeIcon />{t('language')}<span className={styles.end}><LangToggle /></span>
        </div>

        <div className={styles.foot}>
          <button type="button" className={`${styles.row} ${styles.danger}`} tabIndex={open ? 0 : -1}
            onClick={async () => { onClose(); await signOut(); navigate(leaguePath(league.key, 'games'), { replace: true }) }}>
            <OutIcon />{t('signOut')}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const PicksIcon = () => <Icon><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-4.8" /></Icon>
const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></Icon>
const GlobeIcon = () => <Icon><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" /></Icon>
const OutIcon = () => <Icon><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" /></Icon>
const Chevron = () => (
  <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
)

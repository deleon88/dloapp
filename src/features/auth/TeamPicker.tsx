import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { capLogoUrl, getMlbClubs, getTeamMeta, teamLeague, type MlbTeamMeta } from '@/data/teams'
import { useT } from '@/i18n/useT'
import styles from './TeamPicker.module.css'

type League = 'AL' | 'NL'

/** Lowercase, no accents: "Atlético" → "atletico". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Favorite-team field for the profile form: shows the chosen club and opens
 * the picker. The value only changes when the picker is confirmed; saving the
 * profile is what writes it to the database.
 */
export default function TeamField({ value, onChange }: {
  value: number | null
  onChange: (teamId: number | null) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const team = value != null ? getTeamMeta(value) : undefined

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()   // back to the field that opened the picker
  }

  return (
    <>
      <button ref={triggerRef} type="button" className={styles.field} onClick={() => setOpen(true)}
        aria-haspopup="dialog" aria-label={`${t('favoriteTeam')}: ${team ? `${team.name} ${team.brief}` : t('selectYourTeam')}`}>
        {team ? <TeamLogo team={team} size={34} /> : <span className={styles.neutralLogo} aria-hidden="true"><ShieldIcon /></span>}
        <span className={styles.fieldText}>
          {team ? <><span className={styles.fieldCity}>{team.name}</span><span className={styles.fieldName}>{team.brief}</span></>
            : <span className={styles.fieldPlaceholder}>{t('selectYourTeam')}</span>}
        </span>
        <span className={styles.fieldAction}>{t('changeTeam')}</span>
      </button>
      {open && (
        <TeamPicker
          initial={value}
          onCancel={close}
          onConfirm={id => { onChange(id); close() }}
        />
      )}
    </>
  )
}

function TeamPicker({ initial, onCancel, onConfirm }: {
  initial: number | null
  onCancel: () => void
  onConfirm: (teamId: number | null) => void
}) {
  const t = useT()
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const clubs = useMemo(() => getMlbClubs().sort((a, b) => a.brief.localeCompare(b.brief)), [])
  const initialTeam = initial != null ? clubs.find(c => c.id === initial) : undefined

  const [draft, setDraft] = useState<number | null>(initial)
  const [league, setLeague] = useState<League>(initialTeam ? teamLeague(initialTeam) : 'AL')
  const [query, setQuery] = useState('')

  const searching = query.trim().length > 0
  const shown = useMemo(() => {
    if (!searching) return clubs.filter(c => teamLeague(c) === league)
    const q = fold(query.trim())
    return clubs.filter(c => [c.brief, c.name, c.abbr, `${c.name} ${c.brief}`].some(s => fold(s).includes(q)))
  }, [clubs, league, query, searching])
  const draftTeam = draft != null ? clubs.find(c => c.id === draft) : undefined

  // Escape closes; Tab stays inside the dialog; the page behind doesn't scroll.
  // Runs once on open (onCancel through a ref, so re-renders don't refocus the search).
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancelRef.current(); return }
      if (e.key !== 'Tab' || !sheetRef.current) return
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, [tabindex="0"]')].filter(el => el.offsetParent !== null)
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the dialog itself, not the search: on phones that would pop the keyboard over the grid.
    sheetRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // Radio group keyboard: arrows move between teams and select them.
  function onGridKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    if (!(e.key in keys) || !shown.length) return
    e.preventDefault()
    const i = shown.findIndex(c => c.id === draft)
    const next = shown[(Math.max(i, 0) + keys[e.key] + shown.length) % shown.length]
    setDraft(next.id)
    sheetRef.current?.querySelector<HTMLElement>(`[data-team="${next.id}"]`)?.focus()
  }

  // One Tab stop for the whole group: the selected option, or the first team shown.
  const tabTarget = draft == null ? null : shown.some(c => c.id === draft) ? draft : shown[0]?.id

  return (
    <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <span className={styles.grabber} aria-hidden="true" />

        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>{t('pickTeamTitle')}</h2>
          <button type="button" className={styles.closeBtn} onClick={onCancel} aria-label={t('close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.controls}>
          <label className={styles.search}>
            <SearchIcon />
            <input ref={searchRef} type="search" className={styles.searchInput} value={query}
              placeholder={t('searchTeam')} aria-label={t('searchTeam')} autoComplete="off" spellCheck={false}
              onChange={e => setQuery(e.target.value)} />
            {searching && (
              <button type="button" className={styles.clearBtn} aria-label={t('clearSearch')}
                onClick={() => { setQuery(''); searchRef.current?.focus() }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </label>

          {/* Hidden while searching: search covers all 30 clubs. */}
          {!searching && (
            <div className={styles.leagues} role="group" aria-label={`${t('leagueAL')} / ${t('leagueNL')}`}>
              {(['AL', 'NL'] as const).map(l => (
                <button key={l} type="button" aria-pressed={league === l}
                  className={`${styles.league} ${league === l ? styles.leagueActive : ''}`}
                  onClick={() => setLeague(l)}>
                  {t(l === 'AL' ? 'leagueAL' : 'leagueNL')}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.scroll}>
          <p className={styles.srOnly} aria-live="polite">
            {searching ? (shown.length ? t('teamsFound').replace('{n}', String(shown.length)) : t('noTeamFound')) : ''}
          </p>

          <div role="radiogroup" aria-labelledby={titleId} className={styles.options}>
          {shown.length === 0 ? (
            <p className={styles.empty}>{t('noTeamFound')}</p>
          ) : (
            <div className={styles.grid} onKeyDown={onGridKey}>
              {shown.map(c => {
                const selected = c.id === draft
                return (
                  <button key={c.id} type="button" role="radio" aria-checked={selected}
                    aria-label={`${c.name} ${c.brief}`} data-team={c.id}
                    tabIndex={c.id === tabTarget ? 0 : -1}
                    className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
                    style={selected ? { ['--team' as string]: c.barColor ?? c.color } : undefined}
                    onClick={() => setDraft(c.id)}>
                    <span className={styles.check} aria-hidden="true">{selected && <CheckIcon />}</span>
                    <TeamLogo team={c} size={44} />
                    <span className={styles.cardName}>{c.brief}</span>
                  </button>
                )
              })}
            </div>
          )}

          <button type="button" role="radio" aria-checked={draft == null}
            tabIndex={draft == null || shown.length === 0 ? 0 : -1}
            className={`${styles.noneOption} ${draft == null ? styles.noneSelected : ''}`}
            onClick={() => setDraft(null)}>
            <span className={styles.radioDot} aria-hidden="true" />
            {t('noFavoriteTeam')}
          </button>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.summary} aria-live="polite">
            {draftTeam ? <TeamLogo team={draftTeam} size={36} /> : <span className={styles.neutralLogo} aria-hidden="true"><ShieldIcon /></span>}
            <span className={styles.summaryText}>
              <span className={styles.summaryLabel}>{t('selectedTeam')}</span>
              <span className={styles.summaryName}>{draftTeam ? `${draftTeam.name} ${draftTeam.brief}` : t('noFavoriteTeam')}</span>
            </span>
          </div>
          <button type="button" className={styles.confirm} onClick={() => onConfirm(draft)}>{t('confirmTeam')}</button>
        </div>
      </div>
    </div>
  )
}

/** Club cap logo; if the image fails, the abbreviation on the team color. */
function TeamLogo({ team, size }: { team: MlbTeamMeta; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={styles.fallbackLogo} aria-hidden="true"
        style={{ width: size, height: size, background: team.color, fontSize: size * 0.3 }}>
        {team.abbr}
      </span>
    )
  }
  return (
    <img src={capLogoUrl(team.id)} alt="" width={size} height={size} className={styles.logo}
      loading="lazy" onError={() => setFailed(true)} />
  )
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

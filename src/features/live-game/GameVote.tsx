import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { castVote, fetchGameVotes, type GameVotes } from '@/api/votes'
import type { ScheduledGame } from '@/api/mlb/types'
import { getBarColor, getTeamMeta, hexRgba } from '@/data/teams'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n/useT'
import styles from './GameVote.module.css'

/**
 * "Who wins this game?" — one pick per signed-in user, changeable until first
 * pitch. Results (split and vote count) show once you've voted or voting has
 * closed, so they don't sway the pick.
 */
export default function GameVote({ game }: { game: ScheduledGame }) {
  const t = useT()
  const qc = useQueryClient()
  const session = useAuthStore(s => s.session)
  const openAuth = useAuthStore(s => s.openAuth)

  const state = game.status.abstractGameState
  const detailed = game.status.detailedState ?? ''
  const dead = /^(Postponed|Cancelled|Suspended)/.test(detailed)
  const open = state === 'Preview' && !dead

  const key = ['votes', game.gamePk, session?.user.id ?? null]
  const votes = useQuery({
    queryKey: key,
    queryFn: () => fetchGameVotes(game.gamePk),
    refetchInterval: open ? 60_000 : false,
    staleTime: 20_000,
  })
  const vote = useMutation({
    mutationFn: (teamId: number) => castVote(game.gamePk, teamId),
    onSuccess: data => qc.setQueryData<GameVotes>(key, data),
  })

  if (!supabase) return null   // login turned off: no voting

  const sides = (['away', 'home'] as const).map(side => {
    const team = game.teams[side].team
    const meta = getTeamMeta(team.id)
    return {
      id: team.id,
      name: meta?.brief ?? team.name,
      color: meta ? getBarColor(meta) : '#64748b',
    }
  })
  const data = votes.data
  const myVote = data?.myVote ?? null
  const showResults = !!data && data.total > 0 && (myVote != null || !open)
  const pct = (id: number) => (data && data.total ? Math.round(((data.counts[id] ?? 0) / data.total) * 100) : 0)
  const winnerId = state === 'Final'
    ? (game.teams.away.isWinner ? game.teams.away.team.id : game.teams.home.isWinner ? game.teams.home.team.id : null)
    : null

  function pick(teamId: number) {
    if (!session) return openAuth('login')
    if (!open || vote.isPending || teamId === myVote) return
    vote.mutate(teamId)
  }

  const total = data?.total ?? 0
  const countLabel = total === 1 ? t('oneVote') : t('votesCount').replace('{n}', String(total))
  const mine = sides.find(s => s.id === myVote)

  return (
    <section className={styles.card} aria-labelledby={`vote-${game.gamePk}`}>
      <h2 id={`vote-${game.gamePk}`} className={styles.title}>{t('whoWins')}</h2>

      <div className={styles.options} role="radiogroup" aria-labelledby={`vote-${game.gamePk}`}>
        {sides.map(s => {
          const selected = s.id === myVote
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={session != null && !open}
              className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
              style={selected ? { borderColor: s.color, background: hexRgba(s.color, 0.18) } : undefined}
              onClick={() => pick(s.id)}
            >
              {s.name}
              {selected && <span className={styles.check} aria-hidden="true">✓</span>}
              {winnerId === s.id && <span className={styles.winner}>W</span>}
            </button>
          )
        })}
      </div>

      {mine && <p className={styles.mine}>✓ {t('yourVote').replace('{team}', mine.name)}</p>}
      {vote.isError && <p className={styles.error} role="alert">{t('voteFailed')}</p>}

      {showResults && (
        <div className={styles.results}>
          <div className={styles.resultLabels}>
            {sides.map(s => <span key={s.id}>{s.name} {pct(s.id)}%</span>)}
          </div>
          <div className={styles.bar} aria-hidden="true">
            <span style={{ width: `${pct(sides[0].id)}%`, background: sides[0].color }} />
            <span style={{ width: `${100 - pct(sides[0].id)}%`, background: sides[1].color }} />
          </div>
        </div>
      )}

      <p className={styles.footnote}>
        {!session ? t('signInToVote')
          : !open ? `${countLabel} · ${t('votingClosed')}`
          : `${countLabel} · ${t('canChangeBeforeStart')}`}
      </p>
    </section>
  )
}

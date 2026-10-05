import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { castVote, fetchGameVotes, type GameVotes } from '@/api/votes'
import type { ScheduledGame } from '@/api/mlb/types'
import { getTeamMeta, hexRgba } from '@/data/teams'
import { votingEnabled } from '@/lib/features'
import { useAuthStore } from '@/stores/authStore'
import { useT } from '@/i18n/useT'
import CardBgLayers from './CardBgLayers'
import type { ViewMode } from './LineupComparison'
import styles from './GameVote.module.css'

interface Props {
  game: ScheduledGame
  awayColor: string
  homeColor: string
  awayBarColor: string
  homeBarColor: string
  mode: ViewMode
}

/**
 * "Who wins?" — one pick per signed-in user, changeable until first pitch.
 * A single compact row (away pick · question · home pick) on the same team-
 * colored card as the rest of the page. The split shows once you've voted or
 * voting has closed, so it doesn't sway the pick.
 */
export default function GameVote({ game, awayColor, homeColor, awayBarColor, homeBarColor, mode }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const session = useAuthStore(s => s.session)
  const openAuth = useAuthStore(s => s.openAuth)

  const state = game.status.abstractGameState
  const dead = /^(Postponed|Cancelled|Suspended)/.test(game.status.detailedState ?? '')
  const open = state === 'Preview' && !dead

  const key = ['votes', game.gamePk, session?.user.id ?? null]
  const votes = useQuery({
    queryKey: key,
    queryFn: () => fetchGameVotes(game.gamePk),
    enabled: votingEnabled,
    refetchInterval: open ? 60_000 : false,
    staleTime: 20_000,
  })
  const vote = useMutation({
    mutationFn: (teamId: number) => castVote(game.gamePk, teamId),
    onSuccess: data => qc.setQueryData<GameVotes>(key, data),
  })

  if (!votingEnabled) return null

  const sides = ([['away', awayBarColor], ['home', homeBarColor]] as const).map(([side, color]) => {
    const team = game.teams[side].team
    return { side, id: team.id, name: getTeamMeta(team.id)?.brief ?? team.name, color, won: !!game.teams[side].isWinner }
  })
  const data = votes.data
  const myVote = data?.myVote ?? null
  const showResults = !!data && data.total > 0 && (myVote != null || !open)
  const pct = (id: number) => (data?.total ? Math.round(((data.counts[id] ?? 0) / data.total) * 100) : 0)

  function pick(teamId: number) {
    if (!session) return openAuth('login')
    if (!open || vote.isPending || teamId === myVote) return
    vote.mutate(teamId)
  }

  const total = data?.total ?? 0
  const countLabel = total === 1 ? t('oneVote') : t('votesCount').replace('{n}', String(total))
  const footnote = vote.isError ? t('voteFailed')
    : !session ? t('signInToVote')
    : !open ? `${countLabel} · ${t('votingClosed')}`
    : `${countLabel} · ${t('canChangeBeforeStart')}`
  const titleId = `vote-${game.gamePk}`

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

      <div className={styles.row} role="radiogroup" aria-labelledby={titleId}>
        {sides.map((s, i) => {
          const selected = s.id === myVote
          const option = (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={session != null && !open}
              className={`${styles.option} ${i === 1 ? styles.optionHome : ''} ${selected ? styles.optionSelected : ''}`}
              style={selected ? { borderColor: s.color, background: hexRgba(s.color, 0.22) } : undefined}
              onClick={() => pick(s.id)}
            >
              <span className={styles.name}>{s.name}</span>
              {selected && <span className={styles.check} aria-hidden="true">✓</span>}
              {showResults && <span className={styles.pct}>{pct(s.id)}%</span>}
              {s.won && state === 'Final' && <span className={styles.winner}>W</span>}
            </button>
          )
          return i === 0
            ? [option, <span key="q" id={titleId} className={styles.question}>{t('whoWins')}</span>]
            : option
        })}
      </div>

      {showResults && (
        <div className={styles.bar} aria-hidden="true">
          <span style={{ width: `${pct(sides[0].id)}%`, background: sides[0].color }} />
          <span style={{ width: `${pct(sides[1].id)}%`, background: sides[1].color }} />
        </div>
      )}

      <p className={`${styles.footnote} ${vote.isError ? styles.error : ''}`} role={vote.isError ? 'alert' : undefined}>
        {footnote}
      </p>
    </section>
  )
}

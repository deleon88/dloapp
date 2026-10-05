import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { castVote, fetchGameVotes, VoteError, type GameVotes } from '@/api/votes'
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
  // Tapping a team only pre-selects it; the vote is saved on Confirm. Keeps
  // picks deliberate instead of flipping back and forth.
  const [pending, setPending] = useState<number | null>(null)
  const vote = useMutation({
    mutationFn: (teamId: number) => castVote(game.gamePk, teamId),
    onSuccess: data => { qc.setQueryData<GameVotes>(key, data); setPending(null) },
    onError: () => setPending(null),
  })
  // The game started while the page was open: the server says voting is closed.
  const closedByServer = vote.error instanceof VoteError && vote.error.code === 'voting_closed'

  if (!votingEnabled) return null

  const sides = ([['away', awayBarColor], ['home', homeBarColor]] as const).map(([side, color]) => {
    const team = game.teams[side].team
    return { side, id: team.id, name: getTeamMeta(team.id)?.brief ?? team.name, color, won: !!game.teams[side].isWinner }
  })
  const data = votes.data
  const myVote = data?.myVote ?? null
  const showResults = !!data && data.total > 0 && (myVote != null || !open)
  const pct = (id: number) => (data?.total ? Math.round(((data.counts[id] ?? 0) / data.total) * 100) : 0)

  const canVote = open && !closedByServer

  function pick(teamId: number) {
    if (!session) return openAuth('login')
    if (!canVote || vote.isPending) return
    vote.reset()
    setPending(teamId === myVote ? null : teamId)   // tapping your current pick clears the selection
  }

  const total = data?.total ?? 0
  const countLabel = total === 1 ? t('oneVote') : t('votesCount').replace('{n}', String(total))
  const footnote = closedByServer ? t('votingClosed')
    : vote.isError ? t('voteFailed')
    : !session ? t('signInToVote')
    : !open ? `${countLabel} · ${t('votingClosed')}`
    : `${countLabel} · ${t('canChangeBeforeStart')}`
  const pendingSide = sides.find(s => s.id === pending)
  const titleId = `vote-${game.gamePk}`

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />

      <div className={styles.row} role="radiogroup" aria-labelledby={titleId}>
        {sides.map((s, i) => {
          const selected = s.id === myVote
          const preselected = s.id === pending
          const option = (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={session != null && !canVote}
              className={`${styles.option} ${i === 1 ? styles.optionHome : ''} ${selected ? styles.optionSelected : ''} ${preselected ? styles.optionPending : ''}`}
              style={
                preselected ? { borderColor: s.color, background: hexRgba(s.color, 0.12) }
                : selected && !pending ? { borderColor: s.color, background: hexRgba(s.color, 0.22) }
                : undefined
              }
              onClick={() => pick(s.id)}
            >
              <span className={styles.name}>{s.name}</span>
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

      {pendingSide ? (
        <div className={styles.confirmRow} role="group" aria-live="polite">
          <span className={styles.confirmText}>
            {(myVote != null ? t('confirmChangeTo') : t('confirmVoteFor')).replace('{team}', pendingSide.name)}
          </span>
          <button type="button" className={styles.cancelBtn} onClick={() => setPending(null)} disabled={vote.isPending}>
            {t('cancel')}
          </button>
          <button type="button" className={styles.confirmBtn} onClick={() => vote.mutate(pendingSide.id)}
            disabled={vote.isPending} style={{ background: pendingSide.color }}>
            {t('confirm')}
          </button>
        </div>
      ) : (
        <p className={`${styles.footnote} ${vote.isError ? styles.error : ''}`} role={vote.isError ? 'alert' : undefined}>
          {footnote}
        </p>
      )}
    </section>
  )
}

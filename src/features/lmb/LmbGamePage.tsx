import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { getLmbGameDetail } from '@/api/lmb/endpoints/gameDetail'
import { getPitchHands } from '@/api/mlb/endpoints/people'
import { getLmbTeamMeta } from '@/data/lmbTeams'
import CardBgLayers from '@/features/live-game/CardBgLayers'
import type { LmbGameDetail, LmbDetailTeam, LmbProbablePitcher } from '@/api/lmb/types'
import styles from './LmbGamePage.module.css'

export default function LmbGamePage() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()

  const detailQuery = useQuery({
    queryKey: ['lmb-game', gameId],
    queryFn: () => getLmbGameDetail(gameId!),
    enabled: !!gameId,
    staleTime: 30_000,
  })

  const game = detailQuery.data

  const awayPitcherId = game ? extractMlbId(game.awayTeam.probablePitcher?.permalink) : undefined
  const homePitcherId = game ? extractMlbId(game.localTeam.probablePitcher?.permalink) : undefined
  const pitcherIds = [awayPitcherId, homePitcherId].filter((id): id is number => id != null)

  const handQuery = useQuery({
    queryKey: ['pitch-hands', ...pitcherIds],
    queryFn: () => getPitchHands(pitcherIds),
    enabled: pitcherIds.length > 0,
    staleTime: 86_400_000,
  })

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate(-1)}>← Back</button>

      {detailQuery.isLoading && <p className={styles.loading}>Cargando…</p>}
      {detailQuery.error && <p className={styles.loading}>No se pudo cargar el juego.</p>}

      {game && (
        <LmbGameView
          game={game}
          awayPitcherHand={awayPitcherId ? handQuery.data?.get(awayPitcherId) : undefined}
          homePitcherHand={homePitcherId ? handQuery.data?.get(homePitcherId) : undefined}
        />
      )}
    </div>
  )
}

function LmbGameView({
  game,
  awayPitcherHand,
  homePitcherHand,
}: {
  game: LmbGameDetail
  awayPitcherHand?: string
  homePitcherHand?: string
}) {
  const { awayTeam, localTeam, status, date_time, stadium, inning, outs } = game

  const awayMeta = getLmbTeamMeta(awayTeam.shortName)
  const homeMeta = getLmbTeamMeta(localTeam.shortName)
  const ac = awayMeta.color
  const hc = homeMeta.color

  const isFinal = status === 'F'
  const isUpcoming = status === 'P'
  const isLive = !isFinal && !isUpcoming

  const time = date_time ? format(new Date(date_time * 1000), 'h:mm a') : ''

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <CardBgLayers awayColor={ac} homeColor={hc} mode="comparison" />

        <TeamBlock team={awayTeam} />

        <div className={styles.gameInfo}>
          <div className={styles.venueName}>{stadium}</div>
          {isUpcoming && <div className={styles.gameTime}>{time}</div>}
          {isFinal && (
            <div className={styles.gameScores}>
              <span className={styles.scoreVal}>{awayTeam.runsScored}</span>
              <span className={styles.finalLabel}>FINAL</span>
              <span className={styles.scoreVal}>{localTeam.runsScored}</span>
            </div>
          )}
          {isLive && (
            <div className={styles.liveInfo}>
              <span className={styles.scoreVal}>{awayTeam.runsScored}</span>
              <span className={styles.inningLabel}>
                {inning.part === 'Baja' ? '▼' : '▲'}{inning.number}
                {outs > 0 && ` · ${outs} out`}
              </span>
              <span className={styles.scoreVal}>{localTeam.runsScored}</span>
            </div>
          )}
        </div>

        <TeamBlock team={localTeam} right />
      </div>

      {/* ── Pitcher matchup ── */}
      <div className={styles.pitcherCard}>
        <CardBgLayers awayColor={ac} homeColor={hc} mode="comparison" />
        <div className={styles.pitcherRow}>
          <PitcherSide
            pitcher={awayTeam.probablePitcher}
            hand={awayPitcherHand}
          />
          <PitcherSide
            pitcher={localTeam.probablePitcher}
            hand={homePitcherHand}
            right
          />
        </div>
      </div>
    </div>
  )
}

function TeamBlock({ team, right }: { team: LmbDetailTeam; right?: boolean }) {
  const logo = (
    <img
      src={team.urlLogo}
      alt={team.shortName}
      width={44}
      height={44}
      onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
    />
  )

  const text = (
    <div style={right ? { textAlign: 'right' } : {}}>
      <div className={styles.teamCity}>{team.name}</div>
      <div className={styles.teamNickname}>{team.shortName.toUpperCase()}</div>
      <div className={styles.teamRecord}>{team.winGames}-{team.lostGames}</div>
    </div>
  )

  return (
    <div className={`${styles.teamBlock} ${right ? styles.teamBlockRight : ''}`}>
      {right ? <>{text}{logo}</> : <>{logo}{text}</>}
    </div>
  )
}

function PitcherSide({
  pitcher, hand, right,
}: {
  pitcher: LmbProbablePitcher
  hand?: string
  right?: boolean
}) {
  if (!pitcher?.name) {
    const placeholder = <img src="/pitcher-placeholder.svg" alt="" className={styles.headshot} />
    const tbd = (
      <div className={styles.pitcherInfo} style={right ? { textAlign: 'right' } : {}}>
        <div className={styles.pitcherName}>TBD</div>
      </div>
    )
    return (
      <div className={`${styles.pitcherSide} ${right ? styles.pitcherSideRight : ''}`}>
        {right ? <>{tbd}{placeholder}</> : <>{placeholder}{tbd}</>}
      </div>
    )
  }

  const era = pitcher.stats?.replace(' ERA', '') || '—'
  const record = pitcher.extraStats?.replace(/\s/g, '') || '—'

  const info = (
    <div className={styles.pitcherInfo} style={right ? { textAlign: 'right' } : {}}>
      <div className={styles.pitcherMeta} style={right ? { justifyContent: 'flex-end' } : {}}>
        {right && hand && <span>{hand}HP ·</span>}
        {right && <span>{record}</span>}
        {!right && <span>{record}</span>}
        {!right && hand && <span>· {hand}HP</span>}
      </div>
      <div className={styles.pitcherName}>{pitcher.name}</div>
      <div className={styles.pitcherRecord}>{era} ERA</div>
    </div>
  )

  const photo = (
    <img
      src={pitcher.imageUrl || '/pitcher-placeholder.svg'}
      alt={pitcher.name}
      className={styles.headshot}
      onError={(e) => { (e.target as HTMLImageElement).src = '/pitcher-placeholder.svg' }}
    />
  )

  return (
    <div className={`${styles.pitcherSide} ${right ? styles.pitcherSideRight : ''}`}>
      {right ? <>{info}{photo}</> : <>{photo}{info}</>}
    </div>
  )
}

function extractMlbId(permalink?: string): number | undefined {
  if (!permalink) return undefined
  const n = parseInt(permalink.replace('/', ''), 10)
  return isNaN(n) ? undefined : n
}

import type { ViewMode } from './LineupComparison'
import type { BullpenStats, BullpenPitcher } from '@/api/mlb/endpoints/bullpenStats'
import CardBgLayers from './CardBgLayers'
import { useT } from '@/i18n/useT'
import styles from './BullpenCard.module.css'

interface Props {
  away?: BullpenStats
  home?: BullpenStats
  awayColor: string
  homeColor: string
  mode: ViewMode
  isLoading?: boolean
}

export default function BullpenCard({ away, home, awayColor, homeColor, mode, isLoading }: Props) {
  const t = useT()

  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />
      <span className={styles.title}>{t('bullpen')}</span>

      {isLoading || !away || !home ? (
        <div className={styles.placeholder}>{isLoading ? '…' : '—'}</div>
      ) : mode === 'comparison' ? (
        <ComparisonSection away={away} home={home} />
      ) : (
        <SingleSection stats={mode === 'away' ? away : home} />
      )}
    </div>
  )
}

function fipClass(v: number | null) {
  if (v == null) return ''
  if (v < 95) return styles.fipGood
  if (v > 105) return styles.fipBad
  return styles.fipAvg
}

function fmtName(n: string): string {
  const parts = n.split(' ')
  return parts.length > 1 ? `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}` : n
}

function AggRow({ stats }: { stats: BullpenStats }) {
  return (
    <div className={styles.aggRow}>
      <span className={styles.aggStat}>ERA <b>{stats.teamEra ?? '—'}</b></span>
      <span className={styles.aggStat}>
        FIP- <b className={fipClass(stats.teamFipMinus)}>{stats.teamFipMinus ?? '—'}</b>
      </span>
      <span className={styles.aggStat}>WHIP <b>{stats.teamWhip ?? '—'}</b></span>
    </div>
  )
}

function ComparisonSection({ away, home }: { away: BullpenStats; home: BullpenStats }) {
  return (
    <div className={styles.compRoot}>
      <div className={styles.compAggs}>
        <AggRow stats={away} />
        <AggRow stats={home} />
      </div>
      <div className={styles.compCols}>
        <PitcherMiniCol pitchers={away.pitchers.slice(0, 5)} />
        <PitcherMiniCol pitchers={home.pitchers.slice(0, 5)} right />
      </div>
    </div>
  )
}

function PitcherMiniCol({ pitchers, right }: { pitchers: BullpenPitcher[]; right?: boolean }) {
  return (
    <div className={[styles.miniCol, right ? styles.miniColRight : ''].join(' ')}>
      {pitchers.map(p => (
        <div key={p.id} className={styles.miniRow}>
          <span className={styles.miniName}>
            {fmtName(p.name)}<span className={styles.hand}>{p.hand}</span>
          </span>
          <span className={[styles.miniFip, fipClass(p.fipMinus)].join(' ')}>
            {p.fipMinus ?? '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

function SingleSection({ stats }: { stats: BullpenStats }) {
  return (
    <>
      <AggRow stats={stats} />
      <div className={styles.table}>
        <div className={styles.tableHead}>
          <span>Name</span>
          <span>ERA</span>
          <span>FIP</span>
          <span>FIP-</span>
          <span>K/9</span>
          <span>SV/HLD</span>
          <span>IP</span>
        </div>
        {stats.pitchers.map(p => (
          <div key={p.id} className={styles.tableRow}>
            <span className={styles.nameCell}>
              <span className={styles.nameText}>{fmtName(p.name)}</span>
              <span className={styles.hand}>{p.hand}</span>
              {p.pli != null && p.pli > 1.3 && (
                <span className={styles.leverageTag} title={`pLI ${p.pli.toFixed(2)}`}>▲</span>
              )}
            </span>
            <span>{p.era ?? '—'}</span>
            <span>{p.fip != null ? p.fip.toFixed(2) : '—'}</span>
            <span className={fipClass(p.fipMinus)}>{p.fipMinus ?? '—'}</span>
            <span>{p.k9 ?? '—'}</span>
            <span>{p.saves}/{p.holds}</span>
            <span>{p.ip ?? '—'}</span>
          </div>
        ))}
      </div>
    </>
  )
}

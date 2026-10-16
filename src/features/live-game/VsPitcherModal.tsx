import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import { getVsPlayerStats } from '@/api/mlb/endpoints/vsPlayer'
import { useT } from '@/i18n/useT'
import CardModal from './CardModal'
import { cutoutUrl } from './mlbImages'
import styles from './VsPitcherModal.module.css'

/** "Trevor Williams" → ["Trevor", "Williams"] (last name keeps every word after the first). */
function splitName(full: string): [string, string] {
  const [first, ...rest] = full.trim().split(' ')
  return rest.length ? [first, rest.join(' ')] : ['', first]
}

function fmtRate(num: number, den: number): string | null {
  if (den === 0) return null
  const v = num / den
  return v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0\./, '.')
}

interface Props {
  isOpen: boolean
  onClose: () => void
  lineup: LineupSlot[]
  pitcherId: number
  pitcherName: string
  bgColor: string
  side: 'away' | 'home'
  teamLabel: string
}

/** The lineup's career numbers against the opposing starter, TV style. */
export default function VsPitcherModal({
  isOpen, onClose,
  lineup, pitcherId, pitcherName,
  bgColor, side, teamLabel,
}: Props) {
  const t = useT()
  const playerIds = lineup.map(p => p.id)

  const { data: statsMap, isLoading } = useQuery({
    queryKey: ['vsPlayer', playerIds.join(','), pitcherId],
    queryFn: () => getVsPlayerStats(playerIds, pitcherId),
    enabled: isOpen && playerIds.length > 0 && pitcherId > 0,
    staleTime: 5 * 60 * 1000,
  })

  const totals = useMemo(() => {
    if (!statsMap) return null
    let ab = 0, hits = 0, tb = 0, hbp = 0, sf = 0, hr = 0, rbi = 0, bb = 0, k = 0
    for (const s of statsMap.values()) {
      if (!s.hasHistory) continue
      ab   += s.ab;   hits += s.hits; tb   += s.totalBases
      hbp  += s.hbp;  sf   += s.sf;   hr   += s.hr
      rbi  += s.rbi;  bb   += s.bb;   k    += s.k
    }
    if (ab === 0) return null
    const pa  = ab + bb + hbp + sf
    const avg = fmtRate(hits, ab)
    const slg = fmtRate(tb, ab)
    const obp = fmtRate(hits + bb + hbp, pa)
    const opsVal = obp && slg ? parseFloat(obp) + parseFloat(slg) : null
    const ops = opsVal != null ? (opsVal >= 1 ? opsVal.toFixed(3) : opsVal.toFixed(3).replace(/^0\./, '.')) : null
    return { ab, hr, rbi, bb, k, avg, slg, obp, ops }
  }, [statsMap])

  const [, pLast] = splitName(pitcherName)

  return (
    <CardModal
      isOpen={isOpen} onClose={onClose}
      title={teamLabel} subtitle={`vs ${pLast}`}
      awayColor={bgColor} homeColor={bgColor} mode={side}
    >
      {/* ── Column headers (OBP and SLG hide on phones) ── */}
      <div className={`${styles.row} ${styles.colHeader}`}>
        <span /><span />
        <span>AB</span>
        <span>HR</span>
        <span>RBI</span>
        <span>K/BB</span>
        <span>AVG</span>
        <span className={styles.wide}>OBP</span>
        <span className={styles.wide}>SLG</span>
        <span>OPS</span>
      </div>

      {/* ── Batter rows ── */}
      <div className={styles.list}>
        {isLoading ? (
          <p className={styles.loading}>{t('loading')}</p>
        ) : lineup.map((p) => {
          const s = statsMap?.get(p.id)
          const has = s?.hasHistory ?? false
          const c = has ? styles.stat : `${styles.stat} ${styles.noHistory}`
          const d = (v: string | number | null | undefined) => has ? (v ?? '—') : '—'
          const [first, last] = splitName(p.fullName)
          return (
            <div key={p.id} className={styles.row}>
              <span className={styles.photoBox}>
                <img className={styles.photo} src={cutoutUrl(p.id, 96)} alt="" loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }} />
              </span>
              <div className={styles.who} title={p.fullName}>
                {first && <span className={styles.first}>{first}</span>}
                <span className={styles.last}>{last}</span>
              </div>
              <span className={c}>{d(s?.ab)}</span>
              <span className={c}>{d(s?.hr)}</span>
              <span className={c}>{d(s?.rbi)}</span>
              <span className={c}>{has ? `${s!.k}/${s!.bb}` : '—'}</span>
              <span className={c}>{d(s?.avg)}</span>
              <span className={`${c} ${styles.wide}`}>{d(s?.obp)}</span>
              <span className={`${c} ${styles.wide}`}>{d(s?.slg)}</span>
              <span className={has ? `${styles.stat} ${styles.ops}` : `${styles.stat} ${styles.noHistory}`}>{d(s?.ops)}</span>
            </div>
          )
        })}

        {/* Career totals of the lineup */}
        {totals && (() => {
          const d = (v: string | number | null | undefined) => v ?? '—'
          return (
            <div className={`${styles.row} ${styles.summaryRow}`}>
              <span className={styles.summaryLabel}>{t('careerLabel')}</span>
              <span className={styles.stat}>{d(totals.ab)}</span>
              <span className={styles.stat}>{d(totals.hr)}</span>
              <span className={styles.stat}>{d(totals.rbi)}</span>
              <span className={styles.stat}>{totals.k}/{totals.bb}</span>
              <span className={styles.stat}>{d(totals.avg)}</span>
              <span className={`${styles.stat} ${styles.wide}`}>{d(totals.obp)}</span>
              <span className={`${styles.stat} ${styles.wide}`}>{d(totals.slg)}</span>
              <span className={`${styles.stat} ${styles.ops}`}>{d(totals.ops)}</span>
            </div>
          )
        })()}
      </div>
    </CardModal>
  )
}

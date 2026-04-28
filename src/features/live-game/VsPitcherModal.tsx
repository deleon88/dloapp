import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LineupSlot } from '@/api/mlb/endpoints/boxscore'
import { getVsPlayerStats } from '@/api/mlb/endpoints/vsPlayer'
import CardBgLayers from './CardBgLayers'
import styles from './VsPitcherModal.module.css'

function playerPhoto(id: number) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_64,q_auto:best/v1/people/${id}/headshot/67/current`
}

function fmtName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

function lastName(full: string): string {
  const parts = full.trim().split(' ')
  return parts.length < 2 ? full : parts.slice(1).join(' ')
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

export default function VsPitcherModal({
  isOpen, onClose,
  lineup, pitcherId, pitcherName,
  bgColor, side, teamLabel,
}: Props) {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (isOpen) setClosing(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setClosing(true) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClose, 140)
    return () => clearTimeout(t)
  }, [closing, onClose])

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

  if (!isOpen) return null

  return (
    <div className={`${styles.overlay} ${closing ? styles.overlayOut : ''}`}>
      <CardBgLayers awayColor={bgColor} homeColor={bgColor} mode={side} />

      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.teamLabel}>{teamLabel}</span>
        <span className={styles.viewLabel}>vs {lastName(pitcherName)}</span>
        <button className={styles.closeBtn} onClick={() => setClosing(true)} aria-label="Close">✕</button>
      </div>

      {/* ── Column headers ── */}
      <div className={styles.colHeader}>
        <span /><span />
        <span>AB</span>
        <span>HR</span>
        <span>RBI</span>
        <span>BB</span>
        <span>K</span>
        <span>AVG</span>
        <span>SLG</span>
        <span>OBP</span>
        <span>OPS</span>
      </div>

      {/* ── Batter rows ── */}
      <div className={styles.list}>
        {isLoading ? (
          <p className={styles.loading}>Loading…</p>
        ) : lineup.map((p) => {
          const s = statsMap?.get(p.id)
          const has = s?.hasHistory ?? false
          const c = has ? styles.stat : `${styles.stat} ${styles.noHistory}`
          const d = (v: string | number | null | undefined) => has ? (v ?? '—') : '—'
          return (
            <div key={p.id} className={styles.row}>
              <div className={styles.photoWrap}>
                <img
                  className={styles.photo}
                  src={playerPhoto(p.id)}
                  alt={p.fullName}
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0' }}
                />
              </div>
              <div className={styles.playerInfo}>
                <span className={styles.name}>{fmtName(p.fullName)}</span>
                <span className={styles.pos}>{p.pos}</span>
              </div>
              <span className={c}>{d(s?.ab)}</span>
              <span className={c}>{d(s?.hr)}</span>
              <span className={c}>{d(s?.rbi)}</span>
              <span className={c}>{d(s?.bb)}</span>
              <span className={c}>{d(s?.k)}</span>
              <span className={c}>{d(s?.avg)}</span>
              <span className={c}>{d(s?.slg)}</span>
              <span className={c}>{d(s?.obp)}</span>
              <span className={has ? `${styles.stat} ${styles.ops}` : `${styles.stat} ${styles.noHistory}`}>{d(s?.ops)}</span>
            </div>
          )
        })}

        {/* Career totals row */}
        {totals && (() => {
          const t = totals
          const d = (v: string | number | null | undefined) => v ?? '—'
          return (
            <div className={`${styles.row} ${styles.summaryRow}`}>
              <span className={styles.summaryLabel}>CAREER</span>
              <span className={styles.stat}>{d(t.ab)}</span>
              <span className={styles.stat}>{d(t.hr)}</span>
              <span className={styles.stat}>{d(t.rbi)}</span>
              <span className={styles.stat}>{d(t.bb)}</span>
              <span className={styles.stat}>{d(t.k)}</span>
              <span className={styles.stat}>{d(t.avg)}</span>
              <span className={styles.stat}>{d(t.slg)}</span>
              <span className={styles.stat}>{d(t.obp)}</span>
              <span className={`${styles.stat} ${styles.ops}`}>{d(t.ops)}</span>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

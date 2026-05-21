import { useEffect, useState } from 'react'
import type { ViewMode } from './LineupComparison'
import CardBgLayers from './CardBgLayers'
import styles from './CardModal.module.css'

interface Props {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  awayColor?: string
  homeColor?: string
  mode?: ViewMode
  children: React.ReactNode
}

export default function CardModal({ isOpen, onClose, title, subtitle, awayColor, homeColor, mode, children }: Props) {
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

  if (!isOpen) return null

  return (
    <div className={`${styles.overlay} ${closing ? styles.overlayOut : ''}`}>
      {awayColor && homeColor && mode && (
        <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />
      )}

      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        <button className={styles.closeBtn} onClick={() => setClosing(true)} aria-label="Close">✕</button>
      </div>

      {children}
    </div>
  )
}

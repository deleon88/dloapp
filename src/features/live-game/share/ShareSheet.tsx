import { useEffect, useRef, useState } from 'react'
import { getFontEmbedCSS, toBlob } from 'html-to-image'
import { useT } from '@/i18n/useT'
import { getTeamMeta } from '@/data/teams'
import ShareCard, { type ShareData } from './ShareCard'
import styles from './ShareSheet.module.css'

/** The page's web fonts as embeddable CSS, built once (the slow part of the first export). */
let fontCss: Promise<string> | null = null

/** Keeps the Basic Latin @font-face blocks (U+0-FF: accents and ñ included), half the weight of the embedded fonts. */
function latinOnly(css: string): string {
  return css.split('@font-face').filter(b => !/unicode-range/i.test(b) || /unicode-range:\s*U\+0+-FF\b/i.test(b)).join('@font-face')
}

/** Waits for every image inside the card, so the export has the photos and logos. */
async function imagesReady(node: HTMLElement) {
  await Promise.all([...node.querySelectorAll('img')].map(img =>
    img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => undefined)))
}

/**
 * Preview of the shareable image and the two ways out: the phone's share sheet
 * (Web Share with the PNG) or a download where sharing files isn't supported.
 */
export default function ShareSheet({ data: live, onClose }: { data: ShareData; onClose: () => void }) {
  const t = useT()
  // A snapshot: the image shows the page as it was when Share was tapped
  const [data] = useState(live)
  const cardRef = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState(false)
  const [scale, setScale] = useState(1)

  // Fit the 360 × 640 preview in the screen, leaving room for the buttons
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 150) / 640, (window.innerWidth - 32) / 360))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Render the PNG once the card and its images are in place (3× = 1080 × 1920)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const node = cardRef.current
      if (!node) return
      try {
        await document.fonts?.ready
        await imagesReady(node)
        fontCss ??= getFontEmbedCSS(node).then(latinOnly).catch(() => '')
        const blob = await toBlob(node, { pixelRatio: 3, fontEmbedCSS: await fontCss, preferredFontFormat: 'woff2' })
        if (!blob || cancelled) return
        const away = getTeamMeta(data.game.teams.away.team.id)?.abbr ?? 'away'
        const home = getTeamMeta(data.game.teams.home.team.id)?.abbr ?? 'home'
        setFile(new File([blob], `dloapp-${away}-${home}-${data.game.officialDate}.png`.toLowerCase(), { type: 'image/png' }))
      } catch (e) {
        console.error('[share]', e)
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [data])

  const canShareFile = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  function download() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function share() {
    if (!file) return
    if (!canShareFile) return download()
    try {
      await navigator.share({ files: [file], title: 'Dloapp', text: window.location.href })
    } catch (e) {
      // closing the share sheet isn't an error
      if ((e as Error).name !== 'AbortError') download()
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t('shareTitle')} onClick={e => e.stopPropagation()}>
        <div className={styles.preview} style={{ width: 360 * scale, height: 640 * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <ShareCard ref={cardRef} data={data} />
          </div>
          {!file && !error && <div className={styles.busy}>{t('sharePreparing')}</div>}
        </div>

        {error && <p className={styles.error}>{t('shareFailed')}</p>}
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose}>{t('shareClose')}</button>
          {canShareFile && <button className={styles.secondary} onClick={download} disabled={!file}>{t('shareDownload')}</button>}
          <button className={styles.primary} onClick={share} disabled={!file}>
            {canShareFile || !file ? t('share') : t('shareDownload')}
          </button>
        </div>
      </div>
    </div>
  )
}

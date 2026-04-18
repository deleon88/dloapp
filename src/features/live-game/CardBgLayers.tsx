import { teamBg, singleTeamBg } from '@/data/teams'
import type { ViewMode } from './LineupComparison'
import styles from './CardBgLayers.module.css'

interface Props {
  awayColor: string
  homeColor: string
  mode: ViewMode
}

export default function CardBgLayers({ awayColor, homeColor, mode }: Props) {
  return (
    <>
      <div data-card-bg="" className={styles.layer} style={{ background: teamBg(awayColor, homeColor),    opacity: mode === 'comparison' ? 1 : 0 }} />
      <div data-card-bg="" className={styles.layer} style={{ background: singleTeamBg(awayColor, 'away'), opacity: mode === 'away'        ? 1 : 0 }} />
      <div data-card-bg="" className={styles.layer} style={{ background: singleTeamBg(homeColor, 'home'), opacity: mode === 'home'        ? 1 : 0 }} />
    </>
  )
}

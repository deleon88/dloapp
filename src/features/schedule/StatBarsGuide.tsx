import StatGuide, { type GuideTab } from '@/components/StatGuide/StatGuide'
import { useT } from '@/i18n/useT'

/** How to read the schedule's stat bars: FIP+ for starters and bullpen, wRC+ for offense. */
export default function StatBarsGuide({ onClose }: { onClose: () => void }) {
  const t = useT()
  const tabs: GuideTab[] = [
    { id: 'pitching', label: t('guideTabPitching'), desc: t('fipPlusDesc'), average: '100',
      tiers: ['≥ 130', '≥ 120', '≥ 110', '100', '≤ 90', '≤ 85', '≤ 75'] },
    { id: 'offense', label: t('guideTabOffense'), desc: t('wrcPlusDesc'), average: '100',
      tiers: ['≥ 160', '≥ 140', '≥ 115', '100', '≤ 80', '≤ 75', '≤ 60'] },
  ]
  return <StatGuide title={t('statBarsGuide')} tabs={tabs} onClose={onClose} />
}

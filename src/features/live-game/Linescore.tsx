import type { GumboLinescore, GumboTeam } from '@/api/gumbo/types'
import styles from './Linescore.module.css'

interface Props {
  linescore: GumboLinescore
  teams: { away: GumboTeam; home: GumboTeam }
}

export default function Linescore({ linescore, teams }: Props) {
  const { innings, teams: scores } = linescore

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.teamCol} />
            {innings.map((inn) => (
              <th key={inn.num}>{inn.num}</th>
            ))}
            <th className={styles.divider} />
            <th>R</th>
            <th>H</th>
            <th>E</th>
          </tr>
        </thead>
        <tbody>
          <TeamRow
            label={teams.away.teamName}
            innings={innings.map((i) => i.away.runs)}
            totals={scores.away}
          />
          <TeamRow
            label={teams.home.teamName}
            innings={innings.map((i) => i.home.runs)}
            totals={scores.home}
          />
        </tbody>
      </table>
    </div>
  )
}

function TeamRow({
  label,
  innings,
  totals,
}: {
  label: string
  innings: (number | undefined)[]
  totals: { runs?: number; hits?: number; errors?: number }
}) {
  return (
    <tr>
      <td className={styles.teamCol}>{label}</td>
      {innings.map((r, i) => (
        <td key={i}>{r ?? '-'}</td>
      ))}
      <td className={styles.divider} />
      <td className={styles.total}>{totals.runs ?? 0}</td>
      <td className={styles.total}>{totals.hits ?? 0}</td>
      <td className={styles.total}>{totals.errors ?? 0}</td>
    </tr>
  )
}

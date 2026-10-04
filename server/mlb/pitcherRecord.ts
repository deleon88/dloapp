// ERA, W-L and quality starts from the MLB Stats API. These need earned runs and
// decisions, which the stored play-by-play doesn't have. Supports a date range
// (byDateRange) and relief-only splits (sitCodes=rp, season only).
import { getJson } from './pbp.js'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

export interface PitcherRecord {
  era: string | null
  wins: number | null
  losses: number | null
  qualityStarts: number | null
}

interface RawPeople {
  people?: Array<{ id: number; stats?: Array<{ type: { displayName: string }; splits?: Array<{ stat: Record<string, unknown> }> }> }>
}

export async function getPitcherRecords(opts: {
  season: number
  pitcherIds: number[]
  from?: string
  to?: string
  /** Relief-only ERA (season only — MLB can't combine sitCodes with a date range). */
  reliefOnly?: boolean
}): Promise<Map<number, PitcherRecord>> {
  const { season, pitcherIds, from, to, reliefOnly } = opts
  const out = new Map<number, PitcherRecord>()
  if (!pitcherIds.length) return out

  const hydrate = from || to
    ? `stats(group=[pitching],type=[byDateRange],startDate=${from ?? `${season}-01-01`},endDate=${to ?? `${season}-12-31`},season=${season},gameType=R)`
    : reliefOnly
      ? `stats(group=[pitching],type=[statSplits],sitCodes=[rp],season=${season},gameType=R)`
      : `stats(group=[pitching],type=[season,seasonAdvanced],season=${season},gameType=R)`

  for (let i = 0; i < pitcherIds.length; i += 100) {
    const ids = pitcherIds.slice(i, i + 100)
    const data = await getJson<RawPeople>(`${MLB_API}/people?personIds=${ids.join(',')}&hydrate=${hydrate}`)
    for (const p of data.people ?? []) {
      const stats = new Map((p.stats ?? []).map(s => [s.type.displayName, s.splits?.[0]?.stat ?? {}]))
      const main = stats.get('byDateRange') ?? stats.get('statSplits') ?? stats.get('season') ?? {}
      const adv = stats.get('seasonAdvanced') ?? main
      const num = (v: unknown) => (typeof v === 'number' ? v : null)
      out.set(p.id, {
        era: typeof main.era === 'string' ? main.era : null,
        wins: num(main.wins),
        losses: num(main.losses),
        qualityStarts: num(adv.qualityStarts),
      })
    }
  }
  return out
}

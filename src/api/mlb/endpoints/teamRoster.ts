import { mlbApi } from '../client'

const BATTER_POS_CODES = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10'])

export interface DepthPlayer {
  id: number
  fullName: string
  jerseyNumber: string
  posAbbr: string
}

export interface DepthChartData {
  ilSet: Set<number>
  depthByPosition: Map<string, DepthPlayer[]>  // posAbbr → active players, depth order
}

interface RawEntry {
  person: { id: number; fullName: string }
  jerseyNumber: string
  position: { code: string; abbreviation: string }
  status: { code: string }
}

export async function fetchDepthChart(
  teamId: number,
  season = new Date().getFullYear(),
): Promise<DepthChartData> {
  const data = await mlbApi.get<{ roster: RawEntry[] }>(`/teams/${teamId}/roster`, {
    rosterType: 'depthChart',
    season,
    fields: 'roster,person,id,fullName,jerseyNumber,position,code,abbreviation,status,code',
  })

  const ilSet = new Set<number>()
  const depthByPosition = new Map<string, DepthPlayer[]>()

  for (const entry of data.roster ?? []) {
    const { person, position, status, jerseyNumber } = entry
    const isActive = status.code === 'A'

    if (!isActive) {
      ilSet.add(person.id)
      continue
    }

    if (!BATTER_POS_CODES.has(position.code)) continue

    const list = depthByPosition.get(position.abbreviation) ?? []
    list.push({ id: person.id, fullName: person.fullName, jerseyNumber: jerseyNumber ?? '', posAbbr: position.abbreviation })
    depthByPosition.set(position.abbreviation, list)
  }

  return { ilSet, depthByPosition }
}

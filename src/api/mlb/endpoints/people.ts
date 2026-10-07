import { mlbApi } from '../client'
import type { Person } from '../types'

interface PeopleResponse {
  copyright: string
  people: Person[]
}

const PERSON_FIELDS = [
  'people', 'id', 'fullName', 'primaryNumber',
  'currentAge', 'birthDate', 'birthCity', 'birthCountry',
  'height', 'weight', 'primaryPosition', 'abbreviation',
  'pitchHand', 'batSide', 'code', 'description',
  'currentTeam', 'id', 'name',
  'stats', 'group', 'displayName', 'splits', 'stat',
  'avg', 'homeRuns', 'rbi', 'ops', 'obp', 'slg',
  'era', 'whip', 'wins', 'losses', 'strikeOuts', 'inningsPitched',
].join(',')

export function getPerson(personId: number): Promise<PeopleResponse> {
  const season = new Date().getFullYear()
  return mlbApi.get<PeopleResponse>(`/people/${personId}`, {
    season,
    hydrate: `stats(group=[hitting,pitching],type=[season],season=${season}),currentTeam`,
    fields: PERSON_FIELDS,
  })
}

export function getPersonStats(
  personId: number,
  params: { stats: string[]; group: string[]; season?: string },
): Promise<unknown> {
  return mlbApi.get(`/people/${personId}/stats`, {
    stats: params.stats.join(','),
    group: params.group.join(','),
    ...(params.season ? { season: params.season } : {}),
  })
}

interface BulkPersonRow {
  id: number
  fullName: string
  pitchHand?: { code: string; description: string }
}

export async function getPitchHands(personIds: number[]): Promise<Map<number, string>> {
  if (!personIds.length) return new Map()
  const data = await mlbApi.get<{ people: BulkPersonRow[] }>('/people', {
    personIds: personIds.join(','),
    fields: 'people,id,fullName,pitchHand,code,description',
  })
  const map = new Map<number, string>()
  for (const p of data.people ?? []) {
    if (p.pitchHand?.code) map.set(p.id, p.pitchHand.code)
  }
  return map
}

/** Batting side per player: 'L', 'R' or 'S' (switch hitter). */
export async function getBatSides(personIds: number[]): Promise<Map<number, string>> {
  if (!personIds.length) return new Map()
  const data = await mlbApi.get<{ people: Array<{ id: number; batSide?: { code: string } }> }>('/people', {
    personIds: personIds.join(','),
    fields: 'people,id,batSide,code',
  })
  const map = new Map<number, string>()
  for (const p of data.people ?? []) {
    if (p.batSide?.code) map.set(p.id, p.batSide.code)
  }
  return map
}

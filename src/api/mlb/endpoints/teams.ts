import { mlbApi } from '../client'
import type { Team } from '../types'

interface TeamsResponse {
  copyright: string
  teams: Team[]
}

const TEAM_FIELDS = [
  'teams', 'id', 'name', 'abbreviation', 'teamName',
  'locationName', 'firstYearOfPlay',
  'league', 'id', 'name',
  'division', 'id', 'name',
  'venue', 'id', 'name', 'location', 'city',
].join(',')

const ROSTER_FIELDS = [
  'roster', 'person', 'id', 'fullName',
  'primaryNumber', 'primaryPosition', 'abbreviation',
  'pitchHand', 'batSide', 'code',
].join(',')

export function getTeams(params: { sportId?: number; season?: number } = {}): Promise<TeamsResponse> {
  return mlbApi.get<TeamsResponse>('/teams', {
    sportId: 1,
    ...params,
  })
}

export function getTeam(teamId: number, season?: number): Promise<TeamsResponse> {
  return mlbApi.get<TeamsResponse>(`/teams/${teamId}`, {
    season: season ?? new Date().getFullYear(),
    hydrate: 'league,division,venue(location)',
    fields: TEAM_FIELDS,
  })
}

export function getTeamRoster(teamId: number, season?: number): Promise<unknown> {
  return mlbApi.get(`/teams/${teamId}/roster`, {
    rosterType: 'active',
    season: season ?? new Date().getFullYear(),
    hydrate: 'person',
    fields: ROSTER_FIELDS,
  })
}

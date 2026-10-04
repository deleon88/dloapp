import { create } from 'zustand'

// Source of truth: the teams / venues / park_factors tables (db/seeds/teams.csv,
// npm run db:seed-teams), served by /api/teams. TEAMS below is a bundled copy so
// the first paint has the right colors; loadTeams() replaces it with the
// database version on startup.

export interface TeamPark {
  venueId: number
  name: string | null
  roofType: string | null   // Open | Retractable | Dome
  factor: number | null     // FanGraphs basic park factor, 1.00 = neutral
}

export interface MlbTeamMeta {
  id: number
  abbr: string
  name: string      // city
  brief: string     // nickname
  color: string     // primary hex (used for backgrounds)
  color2: string    // secondary hex
  barColor?: string // overrides color for bars only; omit to use color
  capLogoVariant?: 'dark' | 'light'
  leagueId?: number | null
  divisionId?: number | null
  park?: TeamPark | null    // only after loadTeams()
}

export const TEAMS: MlbTeamMeta[] = [
  { id: 108, abbr: 'LAA', name: 'Los Angeles',   brief: 'Angels',     color: '#BA0021', color2: '#003087' },
  { id: 109, abbr: 'ARI', name: 'Arizona',       brief: 'D-backs',    color: '#A71930', color2: '#E3D4AD' },
  { id: 110, abbr: 'BAL', name: 'Baltimore',     brief: 'Orioles',    color: '#DF4601', color2: '#000000' },
  { id: 111, abbr: 'BOS', name: 'Boston',        brief: 'Red Sox',    color: '#BD3039', color2: '#0C2340' },
  { id: 112, abbr: 'CHC', name: 'Chicago',       brief: 'Cubs',       color: '#0E3386', color2: '#CC3433' },
  { id: 113, abbr: 'CIN', name: 'Cincinnati',    brief: 'Reds',       color: '#C6011F', color2: '#000000' },
  { id: 114, abbr: 'CLE', name: 'Cleveland',     brief: 'Guardians',  color: '#00385D', color2: '#E31937', barColor: '#E31937' },
  { id: 115, abbr: 'COL', name: 'Colorado',      brief: 'Rockies',    color: '#33006F', color2: '#C4CED4' },
  { id: 116, abbr: 'DET', name: 'Detroit',       brief: 'Tigers',     color: '#0C2340', color2: '#FA4616', barColor: '#0e325e' },
  { id: 117, abbr: 'HOU', name: 'Houston',       brief: 'Astros',     color: '#002D62', color2: '#EB6E1F', barColor: '#EB6E1F' },
  { id: 118, abbr: 'KCR', name: 'Kansas City',   brief: 'Royals',     color: '#004687', color2: '#BD9B60' },
  { id: 119, abbr: 'LAD', name: 'Los Angeles',   brief: 'Dodgers',    color: '#005A9C', color2: '#EF3E42' },
  { id: 120, abbr: 'WSH', name: 'Washington',    brief: 'Nationals',  color: '#AB0003', color2: '#11225B' },
  { id: 121, abbr: 'NYM', name: 'New York',      brief: 'Mets',       color: '#002D72', color2: '#FF5910', barColor: '#FF5910', capLogoVariant: 'light' },
  { id: 133, abbr: 'ATH', name: 'Sacramento',    brief: 'Athletics',  color: '#003831', color2: '#EFB21E', barColor: '#03534a' },
  { id: 134, abbr: 'PIT', name: 'Pittsburgh',    brief: 'Pirates',    color: '#161512', color2: '#FDB827', barColor: '#FDB827' },
  { id: 135, abbr: 'SDP', name: 'San Diego',     brief: 'Padres',     color: '#2F241D', color2: '#FFC107', barColor: '#FFC107' },
  { id: 136, abbr: 'SEA', name: 'Seattle',       brief: 'Mariners',   color: '#0C2C56', color2: '#005C5C', barColor: '#005C5C' },
  { id: 137, abbr: 'SFG', name: 'San Francisco', brief: 'Giants',     color: '#FD5A1E', color2: '#27251F' },
  { id: 138, abbr: 'STL', name: 'St. Louis',     brief: 'Cardinals',  color: '#C41E3A', color2: '#0C2340' },
  { id: 139, abbr: 'TBR', name: 'Tampa Bay',     brief: 'Rays',       color: '#092C5C', color2: '#8FBCE6', barColor: '#8FBCE6' },
  { id: 140, abbr: 'TEX', name: 'Texas',         brief: 'Rangers',    color: '#003278', color2: '#C0111F' },
  { id: 141, abbr: 'TOR', name: 'Toronto',       brief: 'Blue Jays',  color: '#134A8E', color2: '#E8291C' },
  { id: 142, abbr: 'MIN', name: 'Minnesota',     brief: 'Twins',      color: '#002B5C', color2: '#D31145', barColor: '#D31145' },
  { id: 143, abbr: 'PHI', name: 'Philadelphia',  brief: 'Phillies',   color: '#E81828', color2: '#002D72' },
  { id: 144, abbr: 'ATL', name: 'Atlanta',       brief: 'Braves',     color: '#13274F', color2: '#CE1141', barColor: '#CE1141' },
  { id: 145, abbr: 'CWS', name: 'Chicago',       brief: 'White Sox',  color: '#161512', color2: '#C4CED4', barColor: '#C4CED4' },
  { id: 146, abbr: 'MIA', name: 'Miami',         brief: 'Marlins',    color: '#00A3E0', color2: '#EF3340' },
  { id: 147, abbr: 'NYY', name: 'New York',      brief: 'Yankees',    color: '#003087', color2: '#E4002C' },
  { id: 158, abbr: 'MIL', name: 'Milwaukee',     brief: 'Brewers',    color: '#FFC52F', color2: '#122C4A' },
  { id: 159, abbr: 'AL',  name: 'AL All-Stars',  brief: 'AL All-Stars', color: '#ffffff', color2: '#003087' },
  { id: 160, abbr: 'NL',  name: 'NL All-Stars',  brief: 'NL All-Stars', color: '#ffffff', color2: '#C41E3A' },
]

let byId = new Map(TEAMS.map((t) => [t.id, t]))

export function getTeamMeta(id: number): MlbTeamMeta | undefined {
  return byId.get(id)
}

/**
 * Replaces the team data (from /api/teams). Returns true only if something
 * visible changed (colors, names, logo); park / league data is swapped in
 * silently, so the page doesn't re-render on every load just to add it.
 */
export function setMlbTeams(teams: MlbTeamMeta[]): boolean {
  const visible = (m: Map<number, MlbTeamMeta>) => JSON.stringify([...m.values()]
    .sort((a, b) => a.id - b.id)
    .map(t => [t.id, t.abbr, t.name, t.brief, t.color, t.color2, t.barColor ?? null, t.capLogoVariant ?? 'dark']))
  const next = new Map(teams.map((t) => [t.id, t]))
  const changed = visible(next) !== visible(byId)
  byId = next
  return changed
}

/**
 * Park info of a team's home stadium, for the NRFI model. Retractable roofs
 * count as a controlled environment, like domes. Neutral until loadTeams() runs.
 */
export function getParkInfo(teamId: number): { factor: number; isDome: boolean; name: string } {
  const park = byId.get(teamId)?.park
  return {
    factor: park?.factor ?? 1,
    isDome: park?.roofType === 'Dome' || park?.roofType === 'Retractable',
    name: park?.name ?? 'Unknown Venue',
  }
}

/** Bumped when loadTeams() brings different data, so the UI re-renders with it. */
export const useTeamsVersion = create<{ version: number }>(() => ({ version: 0 }))

/** Returns the color to use for bars — barColor if set, otherwise the primary color. */
export function getBarColor(meta: MlbTeamMeta): string {
  return meta.barColor ?? meta.color
}

export function capLogoUrl(teamId: number): string {
  // Some caps (Mets) only look right on the light variant.
  const variant = byId.get(teamId)?.capLogoVariant === 'light' ? 'team-cap-on-light' : 'team-cap-on-dark'
  return `https://www.mlbstatic.com/team-logos/${variant}/${teamId}.svg`
}

/** Convert a hex color to rgba string */
export function hexRgba(hex: string, alpha = 0.25): string {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Standard two-team card gradient used across all game cards */
export function teamBg(awayColor: string, homeColor: string): string {
  return `linear-gradient(90deg,
    ${hexRgba(awayColor, 0.45)} 0%,
    ${hexRgba(awayColor, 0.20)} 50%,
    ${hexRgba(homeColor, 0.20)} 50%,
    ${hexRgba(homeColor, 0.45)} 100%)`
}

/** Single-team card gradient. side='away' comes from left, 'home' from right. */
export function singleTeamBg(color: string, side: 'away' | 'home'): string {
  const deg = side === 'away' ? 135 : 225
  return `linear-gradient(${deg}deg, ${hexRgba(color, 0.45)} 0%, ${hexRgba(color, 0.15)} 100%)`
}

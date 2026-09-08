/**
 * Fetch pitcher xwOBA from Baseball Savant.
 *
 * Uses the pitch-by-pitch CSV endpoint filtered to a single pitcher, then
 * aggregates estimated_woba_using_speedangle / woba_denom — the same approach
 * used by the Savant leaderboard internally.
 *
 * Routed through /api/savant (Vercel rewrite → baseballsavant.mlb.com) to
 * avoid CORS issues in the browser.
 */

const SAVANT = '/api/savant'

function parseCsvRow(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { fields.push(field); field = '' }
    else { field += ch }
  }
  fields.push(field)
  return fields
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const rawHeaders = parseCsvRow(lines[0])
  // Strip BOM from first header if present
  const headers = rawHeaders.map((h, i) =>
    (i === 0 ? h.replace(/^﻿/, '') : h).trim()
  )
  return lines.slice(1).map(line => {
    const values = parseCsvRow(line)
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]))
  })
}

async function fetchXwobaForPlayer(
  playerId: number,
  season: number,
  type: 'pitcher' | 'batter',
  startDate?: string,
  pitcherThrows?: 'L' | 'R',
): Promise<number | null> {
  const endDate = new Date().toISOString().split('T')[0]
  let url = `${SAVANT}/statcast_search/csv?type=${type}&player_id=${playerId}`
    + `&year=${season}&hfSea=${season}%7C&hfGT=R%7C`
  if (startDate) {
    url += `&game_date_gt=${startDate}&game_date_lt=${endDate}`
  }
  // Batter-hand filter: verified working, exact row-count partition confirmed against
  // a known split. No equivalent batter-stand filter was found for pitcher-type
  // queries (several attempted) — see savantStats.ts's callers for the substitute
  // used on the pitcher side (wOBA-against from the hand-split pipeline instead).
  if (pitcherThrows) {
    url += `&pitcher_throws=${pitcherThrows}`
  }

  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[savant] ${playerId} HTTP ${res.status}`)
      return null
    }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      console.warn(`[savant] ${playerId} got HTML response`)
      return null
    }

    const rows = parseCsv(text)
    let xwNum = 0, xwDen = 0

    for (const row of rows) {
      const wd = parseFloat(row['woba_denom'] ?? '')
      if (!isFinite(wd) || wd === 0) continue

      const wv = parseFloat(row['woba_value'] ?? '') || 0
      const xwvRaw = (row['estimated_woba_using_speedangle'] ?? '').toLowerCase()
      const xwv = (xwvRaw && xwvRaw !== 'null' && xwvRaw !== 'na')
        ? (isFinite(parseFloat(xwvRaw)) ? parseFloat(xwvRaw) : wv)
        : wv

      xwDen += wd
      xwNum += xwv
    }

    const result = xwDen > 0 ? xwNum / xwDen : null
    console.log(`[savant] ${type} ${playerId}: rows=${rows.length} PA=${xwDen} xwOBA=${result?.toFixed(3) ?? 'null'}`)
    return result
  } catch(e) {
    console.error(`[savant] ${playerId} error:`, e)
    return null
  }
}

async function fetchSavantXwobaBulk(
  playerIds: number[],
  season: number,
  type: 'pitcher' | 'batter',
  startDate?: string,
  pitcherThrows?: 'L' | 'R',
): Promise<Map<number, number>> {
  if (!playerIds.length) return new Map()
  const map = new Map<number, number>()
  const results = await Promise.all(
    playerIds.map(id =>
      fetchXwobaForPlayer(id, season, type, startDate, pitcherThrows).then(v => ({ id, v }))
    )
  )
  for (const { id, v } of results) {
    if (v != null) map.set(id, v)
  }
  return map
}

export const fetchSavantPitcherXwoba = (
  ids: number[], season: number, startDate?: string,
) => fetchSavantXwobaBulk(ids, season, 'pitcher', startDate)

/**
 * @param pitcherThrows - optional 'L'|'R' hand filter (vs LHP / vs RHP). Verified
 * working against Baseball Savant's statcast_search/csv endpoint.
 */
export const fetchSavantBatterXwoba = (
  ids: number[], season: number, startDate?: string, pitcherThrows?: 'L' | 'R',
) => fetchSavantXwobaBulk(ids, season, 'batter', startDate, pitcherThrows)

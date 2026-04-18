// FanGraphs TeamNameAbb → MLB team ID
const FG_TO_MLB: Record<string, number> = {
  LAA: 108, ARI: 109, BAL: 110, BOS: 111, CHC: 112, CIN: 113, CLE: 114,
  COL: 115, DET: 116, HOU: 117, KCR: 118, LAD: 119, WSN: 120, NYM: 121,
  OAK: 133, PIT: 134, SDP: 135, SEA: 136, SFG: 137, STL: 138, TBR: 139,
  TEX: 140, TOR: 141, MIN: 142, PHI: 143, ATL: 144, CHW: 145, CWS: 145,
  MIA: 146, NYY: 147, MIL: 158,
}

/** Returns a map of MLB team ID → wRC+ for the current season. */
export async function fetchTeamWrcPlus(): Promise<Map<number, number>> {
  const yr = new Date().getFullYear()
  const url =
    `https://www.fangraphs.com/api/leaders/major-league/data` +
    `?age=&pos=all&stats=bat&lg=all&qual=0` +
    `&season=${yr}&season1=${yr}` +
    `&startdate=${yr}-03-01&enddate=${yr}-11-01` +
    `&month=0&hand=&team=0%2Cts&pageitems=30&pagenum=1` +
    `&ind=0&rost=0&players=&type=23&postseason=` +
    `&sortdir=default&sortstat=wRC%2B`

  try {
    const res = await fetch(url)
    const json = (await res.json()) as { data: Array<{ TeamNameAbb: string; 'wRC+': number }> }
    const map = new Map<number, number>()
    for (const row of json.data ?? []) {
      const mlbId = FG_TO_MLB[row.TeamNameAbb]
      if (mlbId) map.set(mlbId, Math.round(row['wRC+'] ?? 100))
    }
    return map
  } catch {
    return new Map()
  }
}

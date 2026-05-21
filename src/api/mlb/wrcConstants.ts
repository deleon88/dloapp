// FanGraphs linear-weights constants by season.
// Source: https://www.fangraphs.com/guts.aspx?type=cn
// Used to compute wOBA → wRC+ from raw batting counts when the MLB Stats API
// does not return sabermetrics fields for a given split (e.g. vs L/R, by date range).

interface WobaConstants {
  wBB: number; wHBP: number; w1B: number; w2B: number; w3B: number; wHR: number
  lgwOBA: number; wOBAScale: number; lgRPA: number
}

const CONSTANTS: Record<number, WobaConstants> = {
  2022: { wBB:0.693, wHBP:0.722, w1B:0.880, w2B:1.247, w3B:1.578, wHR:1.985, lgwOBA:0.308, wOBAScale:1.146, lgRPA:0.112 },
  2023: { wBB:0.697, wHBP:0.728, w1B:0.895, w2B:1.267, w3B:1.594, wHR:2.058, lgwOBA:0.320, wOBAScale:1.157, lgRPA:0.119 },
  2024: { wBB:0.689, wHBP:0.720, w1B:0.881, w2B:1.248, w3B:1.571, wHR:2.005, lgwOBA:0.317, wOBAScale:1.155, lgRPA:0.118 },
  2025: { wBB:0.688, wHBP:0.720, w1B:0.882, w2B:1.247, w3B:1.570, wHR:2.010, lgwOBA:0.316, wOBAScale:1.155, lgRPA:0.118 },
  2026: { wBB:0.706, wHBP:0.738, w1B:0.901, w2B:1.278, w3B:1.617, wHR:2.078, lgwOBA:0.319, wOBAScale:1.256, lgRPA:0.118 },
}

function getConstants(season: number): WobaConstants {
  if (CONSTANTS[season]) return CONSTANTS[season]
  const known = Object.keys(CONSTANTS).map(Number).filter(y => y <= season)
  return known.length ? CONSTANTS[Math.max(...known)] : CONSTANTS[2026]
}

export interface RawBattingStat {
  atBats: number
  hits: number
  doubles: number
  triples: number
  homeRuns: number
  baseOnBalls: number
  intentionalWalks: number
  hitByPitch: number
  sacFlies: number
  plateAppearances: number
}

const MIN_PA = 15

/**
 * Derives wRC+ from raw batting counts using FanGraphs linear weights.
 * parkFactor defaults to 1.00 (neutral); pass FanGraphs 1yr/100 for park-adjusted result.
 * Formula: (wRAA/PA / lgR/PA + (2 - parkFactor)) × 100
 * Returns null when the sample is too small (< MIN_PA) or denominator is zero.
 */
export function computeWrcPlus(
  raw: RawBattingStat,
  season: number,
  parkFactor = 1.00,
): number | null {
  if ((raw.plateAppearances ?? 0) < MIN_PA) return null
  const c = getConstants(season)
  const singles = raw.hits - raw.doubles - raw.triples - raw.homeRuns
  const uBB     = raw.baseOnBalls - raw.intentionalWalks
  const denom   = raw.atBats + uBB + raw.hitByPitch + raw.sacFlies
  if (denom === 0) return null
  const woba = (c.wBB*uBB + c.wHBP*raw.hitByPitch + c.w1B*singles +
                c.w2B*raw.doubles + c.w3B*raw.triples + c.wHR*raw.homeRuns) / denom
  const wRaa = (woba - c.lgwOBA) / c.wOBAScale * raw.plateAppearances
  return Math.round((wRaa / raw.plateAppearances / c.lgRPA + (2 - parkFactor)) * 100)
}

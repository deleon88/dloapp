// FanGraphs linear-weights constants by season.
// Historical seasons (2022-2025) are hardcoded — they are finalized values.
// Current season is fetched at runtime from /data/linear_weights_{year}.json,
// refreshed daily by the refresh-constants CI workflow. That file's primary
// source is the real FanGraphs Guts page (scripts/fetch_fangraphs_brightdata.py,
// via Bright Data Web Unlocker); it falls back to an RE24 play-by-play
// approximation (scripts/compute_linear_weights.py) only if Bright Data is
// unavailable that day — see .github/workflows/refresh-constants.yml.

interface WobaConstants {
  wBB: number; wHBP: number; w1B: number; w2B: number; w3B: number; wHR: number
  lgwOBA: number; wOBAScale: number; lgRPA: number
  cFIP: number; lgFIP: number; lgHRFB: number
}

// Finalized historical constants (FanGraphs published values; cFIP/lgFIP from guts page)
const HISTORICAL: Record<number, WobaConstants> = {
  2022: { wBB:0.693, wHBP:0.722, w1B:0.880, w2B:1.247, w3B:1.578, wHR:1.985, lgwOBA:0.308, wOBAScale:1.146, lgRPA:0.112, cFIP:3.180, lgFIP:3.96, lgHRFB:0.118 },
  2023: { wBB:0.697, wHBP:0.728, w1B:0.895, w2B:1.267, w3B:1.594, wHR:2.058, lgwOBA:0.320, wOBAScale:1.157, lgRPA:0.119, cFIP:3.026, lgFIP:4.33, lgHRFB:0.120 },
  2024: { wBB:0.689, wHBP:0.720, w1B:0.881, w2B:1.248, w3B:1.571, wHR:2.005, lgwOBA:0.317, wOBAScale:1.155, lgRPA:0.118, cFIP:3.023, lgFIP:4.18, lgHRFB:0.112 },
  // 2025 sourced directly from the FanGraphs Guts page (via Bright Data Web Unlocker,
  // verified against the live table — see scripts/test_brightdata_fangraphs.py).
  // lgHRFB is not a Guts-page column and MLB's teams/stats pitching group doesn't
  // expose flyOuts (compute_fip_constants()'s lgHRFB is unusable — always divides by
  // zero) — kept at the prior approximation until a real source is wired in.
  2025: { wBB:0.691, wHBP:0.722, w1B:0.882, w2B:1.252, w3B:1.584, wHR:2.037, lgwOBA:0.313, wOBAScale:1.232, lgRPA:0.118, cFIP:3.135, lgFIP:4.151, lgHRFB:0.115 /* TODO: verify vs FanGraphs */ },
}

// Live slot for the current season — populated by loadLiveConstants()
let _live: WobaConstants | null = null
let _liveSeason = 0
let _inFlight: Promise<void> | null = null

/**
 * Fetches current-season linear weights from /data/linear_weights_{season}.json.
 * The file is committed daily by the refresh-constants CI workflow before games start.
 * Safe to call concurrently — deduplicates in-flight requests and caches on success.
 * Falls back silently to the most-recent historical constants on any fetch error.
 */
export async function loadLiveConstants(season: number): Promise<void> {
  if (_liveSeason === season && _live !== null) return
  if (_inFlight) return _inFlight
  _inFlight = (async () => {
    try {
      const r = await fetch(`/data/linear_weights_${season}.json`)
      if (r.ok) {
        const d = await r.json() as Record<string, number>
        if (d.wBB && d.w1B && d.wHR) {
          _live = {
            wBB: d.wBB, wHBP: d.wHBP, w1B: d.w1B, w2B: d.w2B,
            w3B: d.w3B, wHR: d.wHR,
            lgwOBA: d.lgwOBA, wOBAScale: d.wOBAScale, lgRPA: d.lgRPA,
            cFIP: d.cFIP ?? 3.077, lgFIP: d.lgFIP ?? 4.05, lgHRFB: d.lgHRFB ?? 0.115,
          }
          _liveSeason = season
        }
      }
    } catch { /* fall through to historical fallback */ }
    _inFlight = null
  })()
  return _inFlight
}

function getConstants(season: number): WobaConstants {
  if (_liveSeason === season && _live) return _live
  const known = Object.keys(HISTORICAL).map(Number).filter(y => y <= season)
  return known.length ? HISTORICAL[Math.max(...known)] : HISTORICAL[2025]
}

export interface RawPitchingStat {
  inningsPitched: number   // decimal IP (e.g. 15.333 for 15⅓)
  homeRuns: number
  baseOnBalls: number
  hitByPitch: number
  strikeOuts: number
  flyOuts?: number         // fly ball outs (excludes HR); required for xFIP
}

const MIN_IP = 5

/**
 * Converts an MLB API IP string ("15.1") to decimal innings.
 * The fractional digit represents thirds, not tenths.
 */
export function ipToDecimal(ip: string | number): number {
  const s = String(ip)
  const dot = s.indexOf('.')
  if (dot === -1) return Number(s)
  return parseInt(s.slice(0, dot), 10) + parseInt(s.slice(dot + 1), 10) / 3
}

/**
 * Computes raw FIP from pitcher counting stats.
 * Returns null when the sample is too small (< MIN_IP) or IP is zero.
 */
export function computeFip(raw: RawPitchingStat, season: number, minIp = MIN_IP): number | null {
  if (raw.inningsPitched < minIp) return null
  const c = getConstants(season)
  return (13 * raw.homeRuns + 3 * (raw.baseOnBalls + raw.hitByPitch) - 2 * raw.strikeOuts)
    / raw.inningsPitched + c.cFIP
}

/**
 * xFIP: replaces actual HR with expected HR based on fly balls × lgHR/FB rate.
 * Formula: (13×(FB×lgHR/FB%) + 3×(BB+HBP) − 2×K) / IP + cFIP
 * Returns null when flyOuts is absent or sample is too small.
 */
export function computeXfip(raw: RawPitchingStat, season: number, minIp = MIN_IP): number | null {
  if (raw.inningsPitched < minIp) return null
  if (raw.flyOuts == null) return null
  const c = getConstants(season)
  const flyBalls = raw.flyOuts + raw.homeRuns
  const expectedHR = flyBalls * c.lgHRFB
  return (13 * expectedHR + 3 * (raw.baseOnBalls + raw.hitByPitch) - 2 * raw.strikeOuts)
    / raw.inningsPitched + c.cFIP
}

/**
 * Park-adjusted FIP- (lower = better, 100 = league average).
 * Formula: 100 × FIP / (lgFIP × parkFactor)
 * A pitcher in a hitter-friendly park (PF > 1) gets credit for the harder environment.
 */
export function computeFipMinus(fip: number, season: number, parkFactor = 1.00): number {
  const c = getConstants(season)
  return Math.round(100 * fip / (c.lgFIP * parkFactor))
}

/**
 * Park-adjusted FIP+ (higher = better, 100 = league average).
 * FanGraphs convention: FIP+ = 200 - FIP-
 */
export function computeFipPlus(fipMinus: number): number {
  return 200 - fipMinus
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

/** Applies FanGraphs linear weights to raw batting counts → raw wOBA value. */
export function computeWoba(raw: RawBattingStat, season: number): number {
  const c       = getConstants(season)
  const singles = raw.hits - raw.doubles - raw.triples - raw.homeRuns
  const uBB     = raw.baseOnBalls - raw.intentionalWalks
  const denom   = raw.atBats + uBB + raw.hitByPitch + raw.sacFlies
  if (denom === 0) return 0
  return (c.wBB*uBB + c.wHBP*raw.hitByPitch + c.w1B*singles +
          c.w2B*raw.doubles + c.w3B*raw.triples + c.wHR*raw.homeRuns) / denom
}

/**
 * Derives wRC+ from raw batting counts using FanGraphs linear weights.
 * parkFactor defaults to 1.00 (neutral); pass FanGraphs 1yr/100 for park-adjusted result.
 * lgCtx lets callers supply live lgwOBA/lgRpa fetched from the API; falls back to hardcoded constants.
 * Formula: (wRAA/PA / lgR/PA + (2 - parkFactor)) × 100
 * Returns null when the sample is too small (< minPA, defaults to MIN_PA) or denominator is zero.
 * Rolling-window hand-split callers pass minPA=0 by product decision — a tiny sample
 * still shows a real (if noisy) number rather than "—"; season-level callers keep the
 * MIN_PA=15 default.
 */
export function computeWrcPlus(
  raw: RawBattingStat,
  season: number,
  parkFactor = 1.00,
  lgCtx?: { lgwOBA?: number; lgRpa?: number },
  minPA = MIN_PA,
): number | null {
  if ((raw.plateAppearances ?? 0) < minPA) return null
  const c      = getConstants(season)
  const lgwOBA = lgCtx?.lgwOBA ?? c.lgwOBA
  const lgRPA  = lgCtx?.lgRpa  ?? c.lgRPA
  const woba   = computeWoba(raw, season)
  if (woba === 0 && raw.atBats === 0) return null
  const wRaa = (woba - lgwOBA) / c.wOBAScale * raw.plateAppearances
  return Math.round((wRaa / raw.plateAppearances / lgRPA + (2 - parkFactor)) * 100)
}

/**
 * OPS (OBP + SLG) from raw batting counts — no league/park adjustment, just
 * the standard box-score formula. Used where a hand/window split has no
 * MLB-supplied `ops` field of its own (e.g. the PBP rolling-window pipeline),
 * so it's derived from the same raw counts already used for wRC+/wOBA.
 * Returns null when AB is zero (SLG undefined) or there's no OBP denominator.
 */
export function computeOps(raw: RawBattingStat): number | null {
  if (raw.atBats <= 0) return null
  const obpDenom = raw.atBats + raw.baseOnBalls + raw.hitByPitch + raw.sacFlies
  if (obpDenom <= 0) return null
  const obp = (raw.hits + raw.baseOnBalls + raw.hitByPitch) / obpDenom
  const totalBases = raw.hits + raw.doubles + 2 * raw.triples + 3 * raw.homeRuns
  const slg = totalBases / raw.atBats
  return obp + slg
}

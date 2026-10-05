// Pure stat formulas (no database), shared by batting.ts / pitching.ts and
// covered by tests/unit/formulas.test.ts.

export interface WobaConstants {
  wBB: number; wHBP: number; w1B: number; w2B: number; w3B: number; wHR: number
  lgwOBA: number; wOBAScale: number; lgRPA: number
}

export interface PitchingConstants extends WobaConstants {
  cFIP: number
  lgFIP: number
  lgHRFB: number
}

/** The counts the rate stats need (a batter's line, or a pitcher's line against). */
export interface RateCounts {
  pa: number
  ab: number
  h1: number
  h2: number
  h3: number
  hr: number
  ubb: number
  ibb: number
  hbp: number
  sf: number
}

export function woba(b: RateCounts, c: WobaConstants): number | null {
  const denom = b.ab + b.ubb + b.hbp + b.sf
  if (!denom) return null
  return (c.wBB * b.ubb + c.wHBP * b.hbp + c.w1B * b.h1 + c.w2B * b.h2 + c.w3B * b.h3 + c.wHR * b.hr) / denom
}

/** wRC+ on an all-MLB base: (wRAA/PA / lgR/PA + (2 − PF)) × 100. */
export function wrcPlus(b: RateCounts, c: WobaConstants, parkFactor = 1): number | null {
  const w = woba(b, c)
  if (w == null || !b.pa) return null
  return ((w - c.lgwOBA) / c.wOBAScale / c.lgRPA + (2 - parkFactor)) * 100
}

/** OBP / SLG; null without plate appearances / at-bats. */
export function obpSlg(c: Omit<RateCounts, 'pa'>): { obp: number | null; slg: number | null } {
  const bb = c.ubb + c.ibb
  const h = c.h1 + c.h2 + c.h3 + c.hr
  const den = c.ab + bb + c.hbp + c.sf
  return {
    obp: den ? (h + bb + c.hbp) / den : null,
    slg: c.ab ? (c.h1 + 2 * c.h2 + 3 * c.h3 + 4 * c.hr) / c.ab : null,
  }
}

export interface PitcherCounts extends Omit<RateCounts, 'pa'> {
  bf: number        // batters faced (completed plate appearances)
  outs: number      // outs recorded, including caught stealing / pickoffs
  so: number
  fb: number        // fly balls + popups (xFIP)
}

export interface PitcherSplit {
  bf: number
  ip: number               // decimal innings (outs / 3)
  so: number
  bb: number               // walks including intentional, like MLB's baseOnBalls
  hbp: number
  hr: number
  h: number
  kbbPct: number | null    // (K − BB) / BF × 100
  whip: number | null
  fip: number | null
  fipMinus: number | null  // park-adjusted, 100 = average; FIP+ = 200 − FIP-
  xfip: number | null
  wobaAgainst: number | null
  opsAgainst: number | null
  /** 100 × (OBP/lgOBP + SLG/lgSLG − 1) vs the league in the same split; lower is better. */
  opsPlusAgainst: number | null
}

const round = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d)

/**
 * A pitcher's line from his counts. `pf` is his batters-faced-weighted park
 * factor; `lg` the league OBP / SLG in the same split (base of OPS+ against).
 */
export function pitcherSplit(
  c: PitcherCounts,
  k: PitchingConstants,
  pf: number,
  lg: { obp: number | null; slg: number | null },
): PitcherSplit {
  const ip = c.outs / 3
  const bb = c.ubb + c.ibb
  const h = c.h1 + c.h2 + c.h3 + c.hr
  const fip = ip > 0 ? (13 * c.hr + 3 * (bb + c.hbp) - 2 * c.so) / ip + k.cFIP : null
  const xfip = ip > 0 ? (13 * c.fb * k.lgHRFB + 3 * (bb + c.hbp) - 2 * c.so) / ip + k.cFIP : null
  // FanGraphs FIP-: (FIP + (FIP − FIP × PF)) / lgFIP × 100, with an all-MLB lgFIP (no AL/NL split).
  const fipMinus = fip != null ? ((fip + (fip - fip * pf)) / k.lgFIP) * 100 : null
  const { obp, slg } = obpSlg(c)
  return {
    bf: c.bf,
    ip: round(ip, 3)!,
    so: c.so, bb, hbp: c.hbp, hr: c.hr, h,
    kbbPct: c.bf ? round(((c.so - bb) / c.bf) * 100, 1) : null,
    whip: ip > 0 ? round((h + bb) / ip, 2) : null,
    fip: round(fip, 2),
    fipMinus: fipMinus == null ? null : Math.round(fipMinus),
    xfip: round(xfip, 2),
    wobaAgainst: c.bf ? round(woba({ ...c, pa: c.bf }, k), 3) : null,
    opsAgainst: obp != null && slg != null ? round(obp + slg, 3) : null,
    opsPlusAgainst: obp != null && slg != null && lg.obp && lg.slg
      ? Math.round(100 * (obp / lg.obp + slg / lg.slg - 1))
      : null,
  }
}

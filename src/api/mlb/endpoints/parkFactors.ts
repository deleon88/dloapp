/**
 * Park factors sourced from Baseball Savant (2024-2026, 3-year rolling composite).
 * https://baseballsavant.mlb.com/leaderboard/park-factors
 *
 * Values are already halved for full-season use (same convention as FanGraphs).
 * factor = Savant_value / 100.  1.00 = league average.
 * > 1.00 = hitter-friendly, < 1.00 = pitcher-friendly.
 *
 * isDome = true for controlled environments (dome or retractable usually closed).
 */
export interface ParkInfo {
  factor: number    // run park factor (1.00 = league average), Savant 3yr ÷ 100
  isDome: boolean
  name: string
}

const PARK_BY_TEAM: Record<number, ParkInfo> = {
  108: { factor: 1.00, isDome: false, name: 'Angel Stadium' },           // LAA
  109: { factor: 1.05, isDome: true,  name: 'Chase Field' },             // ARI
  110: { factor: 1.04, isDome: false, name: 'Camden Yards' },            // BAL
  111: { factor: 1.02, isDome: false, name: 'Fenway Park' },             // BOS
  112: { factor: 0.95, isDome: false, name: 'Wrigley Field' },           // CHC
  113: { factor: 1.03, isDome: false, name: 'Great American Ball Park' },// CIN
  114: { factor: 0.98, isDome: false, name: 'Progressive Field' },       // CLE
  115: { factor: 1.12, isDome: false, name: 'Coors Field' },             // COL
  116: { factor: 1.01, isDome: false, name: 'Comerica Park' },           // DET
  117: { factor: 1.01, isDome: true,  name: 'Daikin Park' },             // HOU
  118: { factor: 1.00, isDome: false, name: 'Kauffman Stadium' },        // KC
  119: { factor: 1.02, isDome: false, name: 'Dodger Stadium' },          // LAD
  120: { factor: 1.01, isDome: false, name: 'Nationals Park' },          // WSH
  121: { factor: 0.99, isDome: false, name: 'Citi Field' },              // NYM
  133: { factor: 1.00, isDome: false, name: 'Sutter Health Park' },      // OAK (temp — no Savant data)
  134: { factor: 1.00, isDome: false, name: 'PNC Park' },                // PIT
  135: { factor: 0.97, isDome: false, name: 'Petco Park' },              // SD
  136: { factor: 0.92, isDome: true,  name: 'T-Mobile Park' },           // SEA
  137: { factor: 0.98, isDome: false, name: 'Oracle Park' },             // SF
  138: { factor: 0.98, isDome: false, name: 'Busch Stadium' },           // STL
  139: { factor: 0.95, isDome: false, name: 'Steinbrenner Field' },      // TB (temp 2026; Savant: Tropicana 95)
  140: { factor: 0.92, isDome: true,  name: 'Globe Life Field' },        // TEX
  141: { factor: 1.01, isDome: true,  name: 'Rogers Centre' },           // TOR
  142: { factor: 1.04, isDome: false, name: 'Target Field' },            // MIN
  143: { factor: 1.02, isDome: false, name: 'Citizens Bank Park' },      // PHI
  144: { factor: 1.00, isDome: false, name: 'Truist Park' },             // ATL
  145: { factor: 0.98, isDome: false, name: 'Guaranteed Rate Field' },   // CWS
  146: { factor: 1.00, isDome: false, name: 'LoanDepot Park' },          // MIA
  147: { factor: 1.02, isDome: false, name: 'Yankee Stadium' },          // NYY
  158: { factor: 0.97, isDome: true,  name: 'American Family Field' },   // MIL
}

/** Returns park info for the HOME team. Defaults to neutral if unknown. */
export function getParkInfo(homeTeamId: number): ParkInfo {
  return PARK_BY_TEAM[homeTeamId] ?? { factor: 1.00, isDome: false, name: 'Unknown Venue' }
}

// ── Handedness park factors ───────────────────────────────────────────────────
// Source: FanGraphs "Handedness Park Factors" tab, 2025 season, ÷ 100.
// Factors are per hit type split by batter handedness (L = left-handed batter, R = right-handed).

export interface HandednessPF {
  singles_L: number; singles_R: number
  doubles_L: number; doubles_R: number
  triples_L: number; triples_R: number
  hr_L: number;      hr_R: number
}

const HAND_PF_BY_TEAM: Record<number, HandednessPF> = {
  108: { singles_L:0.99, singles_R:1.01, doubles_L:0.95, doubles_R:0.97, triples_L:1.01, triples_R:1.00, hr_L:1.07, hr_R:1.04 }, // LAA
  110: { singles_L:1.03, singles_R:1.03, doubles_L:0.95, doubles_R:0.98, triples_L:0.91, triples_R:1.20, hr_L:1.06, hr_R:0.94 }, // BAL
  111: { singles_L:1.04, singles_R:1.05, doubles_L:1.18, doubles_R:1.04, triples_L:1.14, triples_R:1.19, hr_L:0.95, hr_R:1.01 }, // BOS
  112: { singles_L:1.02, singles_R:0.99, doubles_L:0.99, doubles_R:0.93, triples_L:1.29, triples_R:0.96, hr_L:0.97, hr_R:1.01 }, // CHC
  113: { singles_L:1.01, singles_R:1.02, doubles_L:1.00, doubles_R:1.02, triples_L:0.90, triples_R:0.78, hr_L:1.17, hr_R:1.14 }, // CIN
  114: { singles_L:1.00, singles_R:1.01, doubles_L:0.99, doubles_R:1.03, triples_L:0.82, triples_R:0.95, hr_L:1.03, hr_R:0.96 }, // CLE
  115: { singles_L:1.08, singles_R:1.09, doubles_L:1.08, doubles_R:1.13, triples_L:1.28, triples_R:1.42, hr_L:1.05, hr_R:1.08 }, // COL
  116: { singles_L:1.01, singles_R:1.01, doubles_L:0.99, doubles_R:1.03, triples_L:1.43, triples_R:0.96, hr_L:0.95, hr_R:0.98 }, // DET
  117: { singles_L:1.01, singles_R:0.97, doubles_L:1.01, doubles_R:0.98, triples_L:1.29, triples_R:0.99, hr_L:1.02, hr_R:1.02 }, // HOU
  118: { singles_L:1.03, singles_R:1.03, doubles_L:1.07, doubles_R:1.08, triples_L:1.28, triples_R:1.18, hr_L:0.92, hr_R:0.96 }, // KC
  119: { singles_L:0.98, singles_R:0.95, doubles_L:0.98, doubles_R:0.98, triples_L:0.88, triples_R:0.81, hr_L:1.07, hr_R:1.12 }, // LAD
  120: { singles_L:1.03, singles_R:0.99, doubles_L:1.01, doubles_R:0.99, triples_L:0.93, triples_R:1.02, hr_L:0.99, hr_R:1.03 }, // WSH
  121: { singles_L:0.98, singles_R:0.98, doubles_L:0.98, doubles_R:0.93, triples_L:0.85, triples_R:0.91, hr_L:0.97, hr_R:1.01 }, // NYM
  133: { singles_L:1.00, singles_R:1.03, doubles_L:1.06, doubles_R:1.07, triples_L:1.05, triples_R:0.91, hr_L:1.04, hr_R:1.02 }, // OAK
  134: { singles_L:1.02, singles_R:1.02, doubles_L:1.07, doubles_R:1.03, triples_L:0.92, triples_R:1.05, hr_L:0.95, hr_R:0.91 }, // PIT
  135: { singles_L:0.97, singles_R:0.97, doubles_L:0.97, doubles_R:0.94, triples_L:0.83, triples_R:0.89, hr_L:1.01, hr_R:1.00 }, // SD
  136: { singles_L:0.95, singles_R:0.95, doubles_L:0.93, doubles_R:0.93, triples_L:0.75, triples_R:0.84, hr_L:0.93, hr_R:0.98 }, // SEA
  137: { singles_L:1.00, singles_R:1.02, doubles_L:1.02, doubles_R:1.01, triples_L:1.06, triples_R:1.15, hr_L:0.91, hr_R:0.90 }, // SF
  138: { singles_L:1.00, singles_R:1.01, doubles_L:0.96, doubles_R:1.00, triples_L:0.84, triples_R:0.94, hr_L:0.94, hr_R:0.94 }, // STL
  139: { singles_L:1.00, singles_R:1.07, doubles_L:0.96, doubles_R:0.96, triples_L:0.82, triples_R:1.00, hr_L:1.00, hr_R:1.08 }, // TB
  140: { singles_L:0.99, singles_R:0.96, doubles_L:1.01, doubles_R:0.99, triples_L:0.89, triples_R:0.96, hr_L:1.05, hr_R:0.99 }, // TEX
  141: { singles_L:0.97, singles_R:0.98, doubles_L:1.05, doubles_R:0.99, triples_L:0.88, triples_R:0.90, hr_L:0.97, hr_R:1.05 }, // TOR
  142: { singles_L:1.01, singles_R:0.99, doubles_L:1.02, doubles_R:1.06, triples_L:0.93, triples_R:0.91, hr_L:1.02, hr_R:0.96 }, // MIN
  143: { singles_L:1.00, singles_R:0.99, doubles_L:0.95, doubles_R:1.00, triples_L:1.09, triples_R:0.96, hr_L:1.08, hr_R:1.04 }, // PHI
  144: { singles_L:1.02, singles_R:0.99, doubles_L:0.99, doubles_R:0.99, triples_L:0.91, triples_R:1.11, hr_L:0.99, hr_R:0.97 }, // ATL
  145: { singles_L:1.00, singles_R:1.00, doubles_L:0.94, doubles_R:0.98, triples_L:0.84, triples_R:0.90, hr_L:1.08, hr_R:1.03 }, // CWS
  146: { singles_L:1.02, singles_R:1.00, doubles_L:1.00, doubles_R:1.01, triples_L:1.13, triples_R:1.04, hr_L:1.01, hr_R:0.94 }, // MIA
  147: { singles_L:0.97, singles_R:0.97, doubles_L:0.95, doubles_R:0.96, triples_L:0.85, triples_R:0.86, hr_L:1.07, hr_R:1.04 }, // NYY
  158: { singles_L:0.94, singles_R:0.97, doubles_L:0.95, doubles_R:0.97, triples_L:1.07, triples_R:1.00, hr_L:1.05, hr_R:1.02 }, // MIL
}

/**
 * Returns a single composite park factor for a batter's handedness.
 * Weights approximate the MLB hit-type distribution: 60% singles, 20% doubles, 5% triples, 15% HR.
 * Falls back to the basic overall factor when handedness or team data is unavailable.
 */
export function getHandednessParkFactor(
  homeTeamId: number,
  batterHand: 'L' | 'R' | undefined,
): number {
  if (!batterHand) return getParkInfo(homeTeamId).factor
  const h = HAND_PF_BY_TEAM[homeTeamId]
  if (!h) return getParkInfo(homeTeamId).factor
  const isL = batterHand === 'L'
  return (
    (isL ? h.singles_L : h.singles_R) * 0.60 +
    (isL ? h.doubles_L : h.doubles_R) * 0.20 +
    (isL ? h.triples_L : h.triples_R) * 0.05 +
    (isL ? h.hr_L      : h.hr_R)      * 0.15
  )
}

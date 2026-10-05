import { test } from 'node:test'
import assert from 'node:assert/strict'
import { obpSlg, pitcherSplit, woba, wrcPlus, type PitcherCounts, type PitchingConstants } from '../../server/stats/formulas.js'

// 2026 RE24 constants as stored in league_constants (validated against FanGraphs).
const K: PitchingConstants = {
  wBB: 0.713, wHBP: 0.733, w1B: 0.891, w2B: 1.233, w3B: 1.642, wHR: 2.036,
  lgwOBA: 0.316, wOBAScale: 1.23, lgRPA: 0.118, cFIP: 3.093, lgFIP: 4.171, lgHRFB: 0.1318,
}

// Pitcher 669373, 2026 regular season, from the plays table. MLB / FanGraphs:
// FIP 2.50, xFIP 2.69, WHIP 0.96 — the pipeline was validated on these.
const P669373: PitcherCounts = {
  bf: 620, outs: 476, ab: 581, h1: 84, h2: 25, h3: 3, hr: 14,
  ubb: 27, ibb: 0, hbp: 5, sf: 1, so: 186, fb: 124,
}

const near = (actual: number | null, expected: number, tol: number, what: string) => {
  assert.ok(actual != null, `${what} is null`)
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} vs ${expected} (±${tol})`)
}

test('pitcher line reproduces the validated FIP, xFIP, WHIP, K-BB% and wOBA', () => {
  const s = pitcherSplit(P669373, K, 1, { obp: null, slg: null })
  assert.equal(s.fip, 2.5)
  assert.equal(s.xfip, 2.69)
  assert.equal(s.whip, 0.96)
  assert.equal(s.kbbPct, 25.6)
  assert.equal(s.wobaAgainst, 0.264)
  assert.equal(s.ip, 158.667)
  assert.equal(s.h, 126)
})

test('FIP equals cFIP with no HR, walks or strikeouts', () => {
  const s = pitcherSplit({ ...P669373, hr: 0, ubb: 0, ibb: 0, hbp: 0, so: 0, fb: 0 }, K, 1, { obp: null, slg: null })
  // Shown rounded to 2 decimals.
  assert.equal(s.fip, Math.round(K.cFIP * 100) / 100)
  assert.equal(s.xfip, Math.round(K.cFIP * 100) / 100)
})

test('FIP- is 100 for a league-average FIP in a neutral park, and park-adjusts', () => {
  // Choose strikeouts so FIP == lgFIP: (13HR + 3(BB+HBP) − 2K)/IP = lgFIP − cFIP.
  const ip = 60
  const so = (13 * 5 + 3 * 20 - (K.lgFIP - K.cFIP) * ip) / 2
  const c: PitcherCounts = { bf: 250, outs: ip * 3, ab: 220, h1: 30, h2: 10, h3: 1, hr: 5, ubb: 20, ibb: 0, hbp: 0, sf: 2, so, fb: 60 }
  assert.equal(pitcherSplit(c, K, 1, { obp: null, slg: null }).fipMinus, 100)
  // Hitter's park (PF > 1): the same FIP is worth more → lower FIP-.
  assert.ok(pitcherSplit(c, K, 1.1, { obp: null, slg: null }).fipMinus! < 100)
  assert.ok(pitcherSplit(c, K, 0.9, { obp: null, slg: null }).fipMinus! > 100)
})

test('no innings → no FIP, xFIP, WHIP', () => {
  const s = pitcherSplit({ ...P669373, outs: 0 }, K, 1, { obp: null, slg: null })
  assert.equal(s.fip, null)
  assert.equal(s.xfip, null)
  assert.equal(s.whip, null)
})

test('OPS+ against is 100 when the line equals the league split', () => {
  const lg = obpSlg(P669373)
  assert.equal(pitcherSplit(P669373, K, 1, lg).opsPlusAgainst, 100)
  // Worse league (higher OPS) → this pitcher looks better (lower OPS+ against).
  const worseLeague = { obp: lg.obp! * 1.1, slg: lg.slg! * 1.1 }
  assert.ok(pitcherSplit(P669373, K, 1, worseLeague).opsPlusAgainst! < 100)
})

test('wRC+ is 100 for a league-average wOBA in a neutral park', () => {
  // A line whose wOBA is exactly lgwOBA: only walks and outs, with BB rate solved for it.
  const denom = 1000
  const ubb = Math.round((K.lgwOBA * denom) / K.wBB)
  const line = { pa: denom, ab: denom - ubb, h1: 0, h2: 0, h3: 0, hr: 0, ubb, ibb: 0, hbp: 0, sf: 0 }
  near(woba(line, K), K.lgwOBA, 0.001, 'wOBA')
  near(wrcPlus(line, K, 1), 100, 1, 'wRC+')
  // Park factor: −1 wRC+ point per +1% PF for an average hitter... in a hitter's park, fewer.
  near(wrcPlus(line, K, 1.05)! - wrcPlus(line, K, 1)!, -5, 0.001, 'park adjustment')
})

test('wOBA / wRC+ are null without plate appearances', () => {
  const zero = { pa: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, ubb: 0, ibb: 0, hbp: 0, sf: 0 }
  assert.equal(woba(zero, K), null)
  assert.equal(wrcPlus(zero, K), null)
})

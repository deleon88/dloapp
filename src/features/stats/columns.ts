// Stats of the Stats page: every stat each section offers (the user picks which
// ones to show), how to read it from a row and how to print it. `low` = lower
// is better (default sort direction and percentile colors).
import type { BatterRow, PitcherRow, TeamRow } from '@/api/leaders'
import type { TKey } from '@/i18n/useT'

export type Section = 'bat' | 'pit' | 'team'
export type Fmt = 'int' | 'rate' | 'pct' | 'dec1' | 'dec2' | 'ip'

/** One row of any section, flattened so a column is just a getter. */
export type AnyRow = BatterRow | PitcherRow | TeamRow

export interface Column {
  id: string
  label: string
  get: (r: AnyRow) => number | null | undefined
  fmt: Fmt
  low?: boolean
  /** No opponent-hand split (MLB's runs, steals, ERA, decisions): sorting by it locks the hand filter. */
  noHand?: boolean
}

/** A heading of the stat picker. */
export interface Category {
  label: TKey
  cols: Column[]
}

const c = <R extends AnyRow>(id: string, label: string, get: (r: R) => number | null | undefined, fmt: Fmt, low = false): Column =>
  ({ id, label, get: get as Column['get'], fmt, low })
const noHand = (col: Column): Column => ({ ...col, noHand: true })

// ── Batters ──
type B = BatterRow
const bat = {
  g: c<B>('g', 'G', r => r.g, 'int'),
  pa: c<B>('pa', 'PA', r => r.pa, 'int'),
  ab: c<B>('ab', 'AB', r => r.ab, 'int'),
  h: c<B>('h', 'H', r => r.h, 'int'),
  d2: c<B>('d2', '2B', r => r.d2, 'int'),
  d3: c<B>('d3', '3B', r => r.d3, 'int'),
  hr: c<B>('hr', 'HR', r => r.hr, 'int'),
  r: noHand(c<B>('r', 'R', r => r.r, 'int')),
  rbi: c<B>('rbi', 'RBI', r => r.rbi, 'int'),
  bb: c<B>('bb', 'BB', r => r.bb, 'int'),
  so: c<B>('so', 'SO', r => r.so, 'int', true),
  hbp: c<B>('hbp', 'HBP', r => r.hbp, 'int'),
  sb: noHand(c<B>('sb', 'SB', r => r.sb, 'int')),
  cs: noHand(c<B>('cs', 'CS', r => r.cs, 'int', true)),
  avg: c<B>('avg', 'AVG', r => r.avg, 'rate'),
  obp: c<B>('obp', 'OBP', r => r.obp, 'rate'),
  slg: c<B>('slg', 'SLG', r => r.slg, 'rate'),
  ops: c<B>('ops', 'OPS', r => r.ops, 'rate'),
  iso: c<B>('iso', 'ISO', r => r.iso, 'rate'),
  babip: c<B>('babip', 'BABIP', r => r.babip, 'rate'),
  bbPct: c<B>('bbPct', 'BB%', r => r.bbPct, 'pct'),
  kPct: c<B>('kPct', 'K%', r => r.kPct, 'pct', true),
  kbbPct: c<B>('kbbPct', 'K-BB%', r => r.kbbPct, 'pct', true),
  woba: c<B>('woba', 'wOBA', r => r.woba, 'rate'),
  wrcPlus: c<B>('wrcPlus', 'wRC+', r => r.wrcPlus, 'int'),
  gbPct: c<B>('gbPct', 'GB%', r => r.gbPct, 'pct'),
  ldPct: c<B>('ldPct', 'LD%', r => r.ldPct, 'pct'),
  fbPct: c<B>('fbPct', 'FB%', r => r.fbPct, 'pct'),
  hrFb: c<B>('hrFb', 'HR/FB', r => r.hrFb, 'pct'),
}

// ── Pitchers ──
type P = PitcherRow
const pit = {
  w: noHand(c<P>('w', 'W', r => r.w, 'int')),
  l: noHand(c<P>('l', 'L', r => r.l, 'int', true)),
  sv: noHand(c<P>('sv', 'SV', r => r.sv, 'int')),
  hld: noHand(c<P>('hld', 'HLD', r => r.hld, 'int')),
  g: c<P>('g', 'G', r => r.g, 'int'),
  gs: c<P>('gs', 'GS', r => r.gs, 'int'),
  ip: c<P>('ip', 'IP', r => r.ip, 'ip'),
  h: c<P>('h', 'H', r => r.h, 'int', true),
  hr: c<P>('hr', 'HR', r => r.hr, 'int', true),
  bb: c<P>('bb', 'BB', r => r.bb, 'int', true),
  so: c<P>('so', 'SO', r => r.so, 'int'),
  era: noHand(c<P>('era', 'ERA', r => r.era, 'dec2', true)),
  whip: c<P>('whip', 'WHIP', r => r.whip, 'dec2', true),
  avg: c<P>('avg', 'AVG', r => r.avgAgainst, 'rate', true),
  woba: c<P>('woba', 'wOBA', r => r.wobaAgainst, 'rate', true),
  kPct: c<P>('kPct', 'K%', r => r.kPct, 'pct'),
  bbPct: c<P>('bbPct', 'BB%', r => r.bbPct, 'pct', true),
  kbbPct: c<P>('kbbPct', 'K-BB%', r => r.kbbPct, 'pct'),
  hr9: c<P>('hr9', 'HR/9', r => r.hr9, 'dec2', true),
  babip: c<P>('babip', 'BABIP', r => r.babip, 'rate', true),
  fip: c<P>('fip', 'FIP', r => r.fip, 'dec2', true),
  fipMinus: c<P>('fipMinus', 'FIP-', r => r.fipMinus, 'int', true),
  xfip: c<P>('xfip', 'xFIP', r => r.xfip, 'dec2', true),
  gbPct: c<P>('gbPct', 'GB%', r => r.gbPct, 'pct'),
  ldPct: c<P>('ldPct', 'LD%', r => r.ldPct, 'pct', true),
  fbPct: c<P>('fbPct', 'FB%', r => r.fbPct, 'pct', true),
  hrFb: c<P>('hrFb', 'HR/FB', r => r.hrFb, 'pct', true),
}

// ── Teams ──
type T = TeamRow
const team = {
  w: c<T>('w', 'W', r => r.w, 'int'),
  l: c<T>('l', 'L', r => r.l, 'int', true),
  g: c<T>('g', 'G', r => r.g, 'int'),
  r: c<T>('r', 'R', r => r.r, 'int'),
  hr: c<T>('hr', 'HR', r => r.bat.hr, 'int'),
  sb: noHand(c<T>('sb', 'SB', r => r.sb, 'int')),
  bbPct: c<T>('bbPct', 'BB%', r => r.bat.bbPct, 'pct'),
  kPct: c<T>('kPct', 'K%', r => r.bat.kPct, 'pct', true),
  iso: c<T>('iso', 'ISO', r => r.bat.iso, 'rate'),
  babip: c<T>('babip', 'BABIP', r => r.bat.babip, 'rate'),
  avg: c<T>('avg', 'AVG', r => r.bat.avg, 'rate'),
  obp: c<T>('obp', 'OBP', r => r.bat.obp, 'rate'),
  slg: c<T>('slg', 'SLG', r => r.bat.slg, 'rate'),
  woba: c<T>('woba', 'wOBA', r => r.bat.woba, 'rate'),
  wrcPlus: c<T>('wrcPlus', 'wRC+', r => r.bat.wrcPlus, 'int'),
  era: noHand(c<T>('era', 'ERA', r => r.era, 'dec2', true)),
  ip: c<T>('ip', 'IP', r => r.pit.ip, 'ip'),
  pkPct: c<T>('pkPct', 'K% (P)', r => r.pit.kPct, 'pct'),
  pbbPct: c<T>('pbbPct', 'BB% (P)', r => r.pit.bbPct, 'pct', true),
  kbbPct: c<T>('kbbPct', 'K-BB%', r => r.pit.kbbPct, 'pct'),
  hr9: c<T>('hr9', 'HR/9', r => r.pit.hr9, 'dec2', true),
  whip: c<T>('whip', 'WHIP', r => r.pit.whip, 'dec2', true),
  pbabip: c<T>('pbabip', 'BABIP (P)', r => r.pit.babip, 'rate', true),
  gbPct: c<T>('gbPct', 'GB%', r => r.pit.gbPct, 'pct'),
  fip: c<T>('fip', 'FIP', r => r.pit.fip, 'dec2', true),
  fipMinus: c<T>('fipMinus', 'FIP-', r => r.pit.fipMinus, 'int', true),
  xfip: c<T>('xfip', 'xFIP', r => r.pit.xfip, 'dec2', true),
}

export const CATALOG: Record<Section, Category[]> = {
  bat: [
    { label: 'catStandard', cols: [bat.g, bat.pa, bat.ab, bat.h, bat.d2, bat.d3, bat.hr, bat.r, bat.rbi, bat.bb, bat.so, bat.hbp, bat.sb, bat.cs] },
    { label: 'catRates', cols: [bat.avg, bat.obp, bat.slg, bat.ops, bat.iso, bat.babip] },
    { label: 'catDiscipline', cols: [bat.bbPct, bat.kPct, bat.kbbPct] },
    { label: 'catValue', cols: [bat.woba, bat.wrcPlus] },
    { label: 'grpBattedBall', cols: [bat.gbPct, bat.ldPct, bat.fbPct, bat.hrFb] },
  ],
  pit: [
    { label: 'catStandard', cols: [pit.w, pit.l, pit.era, pit.g, pit.gs, pit.sv, pit.hld, pit.ip, pit.h, pit.hr, pit.bb, pit.so, pit.whip, pit.avg] },
    { label: 'catDiscipline', cols: [pit.kPct, pit.bbPct, pit.kbbPct, pit.hr9] },
    { label: 'grpAdvanced', cols: [pit.babip, pit.woba, pit.fip, pit.fipMinus, pit.xfip] },
    { label: 'grpBattedBall', cols: [pit.gbPct, pit.ldPct, pit.fbPct, pit.hrFb] },
  ],
  team: [
    { label: 'grpBatting', cols: [team.w, team.l, team.r, team.hr, team.sb, team.bbPct, team.kPct, team.iso, team.babip, team.avg, team.obp, team.slg, team.woba, team.wrcPlus] },
    { label: 'grpPitching', cols: [team.era, team.ip, team.pkPct, team.pbbPct, team.kbbPct, team.hr9, team.whip, team.pbabip, team.gbPct, team.fip, team.fipMinus, team.xfip] },
  ],
}

/** What each section shows until the user picks its own stats. */
export const DEFAULT_STATS: Record<Section, string[]> = {
  bat: ['pa', 'hr', 'r', 'rbi', 'sb', 'avg', 'obp', 'slg', 'bbPct', 'kPct', 'woba', 'wrcPlus'],
  pit: ['w', 'l', 'era', 'ip', 'kPct', 'bbPct', 'kbbPct', 'whip', 'fip', 'xfip'],
  team: ['w', 'l', 'r', 'hr', 'woba', 'wrcPlus', 'era', 'kbbPct', 'fip'],
}

/** Sort column of a section when it opens (if shown). */
export const DEFAULT_SORT: Record<Section, string> = { bat: 'wrcPlus', pit: 'fip', team: 'wrcPlus' }

/** The chosen stats, in catalog order (unknown ids are dropped). */
export function columnsFor(sec: Section, ids: string[]): Column[] {
  const want = new Set(ids)
  return CATALOG[sec].flatMap(cat => cat.cols).filter(col => want.has(col.id))
}

/** "158.667" innings → "158.2" (outs after the dot). */
function fmtIp(ip: number): string {
  const outs = Math.round(ip * 3)
  return `${Math.floor(outs / 3)}.${outs % 3}`
}

export function formatStat(v: number | null | undefined, fmt: Fmt): string {
  if (v == null || !Number.isFinite(v)) return '—'
  switch (fmt) {
    case 'int': return String(Math.round(v))
    case 'rate': return v.toFixed(3).replace(/^(-?)0\./, '$1.')
    case 'pct': return `${v.toFixed(1)}%`
    case 'dec1': return v.toFixed(1)
    case 'dec2': return v.toFixed(2)
    case 'ip': return fmtIp(v)
  }
}

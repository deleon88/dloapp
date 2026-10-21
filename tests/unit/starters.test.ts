import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asTurn, CYCLE_BACK, nextStarter, projectSeries, rankStarters, rotation, STALE_DAYS, type ProjectOptions, type Start } from '../../server/starters/project.js'

const REG: ProjectOptions = { postseason: false, staleDays: STALE_DAYS, cycleBack: CYCLE_BACK }
const st = (date: string, pitcherId: number, pitches = 90): Start => ({ date, pitcherId, pitches })

// A five-man turn, one start a day: 1..5 on Jun 1–5, again Jun 6–10
const turn = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5].map((id, i) => st(`2026-06-${String(i + 1).padStart(2, '0')}`, id))

test('the regular-season pick is the turn: whoever started five games ago', () => {
  assert.equal(nextStarter(turn, '2026-06-11', REG), 1)
})

test('short outings (openers) do not make the rotation', () => {
  assert.deepEqual(rotation([...turn, st('2026-06-11', 9, 22)]).includes(9), false)
})

test('an arm who has not started in a long while is out (hurt or sent down)', () => {
  const starts = [st('2026-05-20', 7), ...turn.slice(5)]
  assert.equal(rankStarters(starts, '2026-06-11', REG).includes(7), false)
})

test('nobody on short rest: no pick', () => {
  assert.equal(nextStarter([st('2026-06-10', 1)], '2026-06-12', REG), null)
})

test('unavailable arms are skipped and the next one up starts', () => {
  assert.equal(nextStarter(turn, '2026-06-11', { ...REG, unavailable: new Set([1]) }), 2)
})

test('postseason: the order of the latest playoff series beats FIP', () => {
  // LCS order: 1, 2, 3, 4; 3 has the best FIP, but 2 comes after 1
  const quality = new Map([[1, 2.8], [2, 3.4], [3, 2.6], [4, 3.9]])
  const lcs = [1, 2, 3, 4].map((id, i) => ({ ...st(`2026-10-1${i + 2}`, id), post: true }))
  const series = projectSeries(lcs, [{ date: '2026-10-23' }, { date: '2026-10-24' }, { date: '2026-10-26' }],
    { postseason: true, quality, staleDays: STALE_DAYS })
  assert.deepEqual(series.map(s => s.id), [1, 2, 3])
})

test('postseason before any playoff series: among the rested arms, the best FIP', () => {
  const quality = new Map([[1, 4.5], [2, 2.6], [3, 3.9], [4, 3.1], [5, 4.0]])
  const starts = [st('2026-10-01', 1), st('2026-10-02', 2), st('2026-10-04', 3), st('2026-10-05', 4)]
  // Oct 9: 1, 2 and 3 have 4+ days of rest; 2 has the best FIP
  assert.equal(nextStarter(starts, '2026-10-09', { postseason: true, quality, staleDays: STALE_DAYS }), 2)
})

test('a series projection uses each pick up before the next game and keeps the announced ones', () => {
  const series = projectSeries(turn, [
    { date: '2026-06-11' }, { date: '2026-06-12', announced: 4 }, { date: '2026-06-13' },
  ], REG)
  assert.deepEqual(series, [{ id: 1, projected: true }, { id: 4, projected: false }, { id: 3, projected: true }])
})

test("an opener's game is its bulk arm's turn, and the pair is projected together", () => {
  const OPENER = 8, BULK = 9
  // the LCS: 1, 2, 3, then 8 opens (25 pitches) with 9 behind him (70)
  const lcs = [
    asTurn({ ...st('2026-10-11', 1), post: true }),
    asTurn({ ...st('2026-10-12', 2), post: true }),
    asTurn({ ...st('2026-10-14', 3), post: true }),
    asTurn({ date: '2026-10-15', pitcherId: OPENER, pitches: 25, post: true, bulkId: BULK, bulkPitches: 70 }),
  ]
  assert.deepEqual(lcs[3], { date: '2026-10-15', pitcherId: BULK, pitches: 70, post: true, opener: OPENER })
  const series = projectSeries(lcs, [{ date: '2026-10-23' }, { date: '2026-10-24' }, { date: '2026-10-26' }, { date: '2026-10-27' }],
    { postseason: true, staleDays: STALE_DAYS })
  assert.deepEqual(series[3], { id: BULK, projected: true, opener: OPENER })
})

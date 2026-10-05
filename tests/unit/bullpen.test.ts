import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectBullpen, type Appearance, type SelectionInput } from '../../server/bullpen/select.js'

const TODAY = '2026-10-04', Y = '2026-10-03', Y2 = '2026-10-02'

function input(over: Partial<SelectionInput> = {}): SelectionInput {
  return {
    depthChart: [], injured: new Set(), pli: new Map(), usage: new Map(),
    gamesPlayed: 7, today: TODAY, yesterday: Y, twoDaysAgo: Y2, ...over,
  }
}
const relief = (date: string, pitches: number): Appearance => ({ date, pitches, isStarter: false })
const ids = (r: Array<{ id: number }>) => r.map(x => x.id)

test('the pitch gate leaves out arms over 30 pitches yesterday or 50 in two days', () => {
  const r = selectBullpen(input({
    depthChart: [{ id: 1, isCloser: false, order: 0 }, { id: 2, isCloser: false, order: 1 }, { id: 3, isCloser: false, order: 2 }],
    usage: new Map([
      [1, [relief(Y, 31)]],                       // > 30 yesterday
      [2, [relief(Y2, 25), relief(Y, 25)]],       // 50 in two days
      [3, [relief(Y2, 20), relief(Y, 20)]],       // 40: available
    ]),
  }))
  assert.deepEqual(ids(r), [3])
})

test('injured arms, starters and bulk relievers are left out', () => {
  const r = selectBullpen(input({
    depthChart: [{ id: 1, isCloser: false, order: 0 }, { id: 4, isCloser: false, order: 1 }],
    injured: new Set([1]),
    usage: new Map([
      [2, [{ date: '2026-09-30', pitches: 95, isStarter: true }]],   // only starts
      [3, [relief('2026-09-29', 62)]],                               // bulk (> 50 per relief outing)
      [4, [relief('2026-09-30', 15)]],
    ]),
  }))
  assert.deepEqual(ids(r), [4])
})

test('a reliever who pitched recently but is not on the depth chart still counts', () => {
  const r = selectBullpen(input({ usage: new Map([[9, [relief('2026-09-30', 18)]]]) }))
  assert.deepEqual(ids(r), [9])
})

test('the closer and high-leverage arms rank first; at most 8 arms', () => {
  const depthChart = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, isCloser: i === 9, order: i }))
  const r = selectBullpen(input({
    depthChart,
    pli: new Map([[105, 2.0]]),
    usage: new Map(depthChart.map(a => [a.id, [relief('2026-10-01', 15)]])),
  }))
  assert.equal(r.length, 8)
  assert.deepEqual(ids(r).slice(0, 2), [105, 109])   // pLI 2.0 (+40), then the closer (+15)
})

test('two days of rest scores higher than pitching yesterday', () => {
  const r = selectBullpen(input({
    depthChart: [{ id: 1, isCloser: false, order: 0 }, { id: 2, isCloser: false, order: 0 }],
    usage: new Map([[1, [relief(Y, 12)]], [2, [relief(Y2, 12)]]]),
  }))
  assert.deepEqual(ids(r), [2, 1])
})

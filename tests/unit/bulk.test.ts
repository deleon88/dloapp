import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictBulk, type TeamAppearance } from '../../server/openers/bulk.js'

const TODAY = 1000
const app = (pitcherId: number, daysAgo: number, outs: number, pitches: number, extra: Partial<TeamAppearance> = {}): TeamAppearance =>
  ({ pitcherId, day: TODAY - daysAgo, isStart: false, outs, pitches, bulk: false, ...extra })

test('the arm on a starter cadence (6 days since a long outing) who was the bulk before is named', () => {
  const r = predictBulk([
    app(1, 6, 15, 75, { bulk: true }), app(1, 12, 14, 70, { bulk: true }),
    app(2, 2, 3, 15), app(3, 1, 3, 12),
  ], TODAY, new Set([99]))
  assert.equal(r.candidates[0].pitcherId, 1)
  assert.equal(r.confident, true)
})

test('two rotation arms on the same cadence: not confident enough to name one', () => {
  const r = predictBulk([app(1, 6, 15, 85, { isStart: true }), app(2, 6, 16, 90, { isStart: true })], TODAY, new Set())
  assert.equal(r.confident, false)
})

test("the next game's announced starter and the opener are left out", () => {
  const history = [app(1, 6, 15, 85, { isStart: true }), app(2, 5, 16, 90, { isStart: true })]
  const r = predictBulk(history, TODAY, new Set([1]))
  assert.deepEqual(r.candidates.map(c => c.pitcherId), [2])
})

test('not rested, not on the active roster, or no long outing: not a candidate', () => {
  const r = predictBulk([
    app(1, 2, 15, 80),               // long outing 2 days ago
    app(2, 6, 15, 80),               // not active
    app(3, 3, 3, 15), app(3, 8, 4, 20), // never long
  ], TODAY, new Set(), new Set([1, 3]))
  assert.equal(r.candidates.length, 0)
  assert.equal(r.confident, false)
})

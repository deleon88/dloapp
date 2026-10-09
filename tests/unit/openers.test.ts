import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPitcher, type Appearance } from '../../server/openers/detect.js'

const start = (outs: number, pitches?: number): Appearance => ({ isStart: true, outs, pitches })
const relief = (outs: number): Appearance => ({ isStart: false, outs })

test('a regular starter is a starter, even after one short outing', () => {
  assert.equal(classifyPitcher([start(4), start(18), start(17), start(19), start(16)]).role, 'starter')
})

test('a pattern of short starts makes an opener', () => {
  const r = classifyPitcher([start(3), relief(3), start(6), start(5), relief(4), start(18)])
  assert.equal(r.role, 'opener')
  assert.equal(r.shortStarts, 3)
})

test('a short reliever handed the start is an opener', () => {
  assert.equal(classifyPitcher([relief(3), relief(2), relief(3), relief(4)]).role, 'opener')
})

test('a long reliever moving into the rotation is not', () => {
  assert.equal(classifyPitcher([relief(9), relief(10), relief(8), relief(7)]).role, 'starter')
})

test('a reliever being stretched out into the rotation is a starter', () => {
  // Starts getting longer: the latest went 4 innings.
  assert.equal(classifyPitcher([start(12, 59), start(8, 45), relief(3), relief(3), relief(2), relief(3)]).role, 'starter')
  // Or 50+ pitches even with few outs.
  assert.equal(classifyPitcher([start(5, 62), start(3), start(4), start(5)]).role, 'starter')
})

test("a reliever's first start: spot start if they go long in relief, opener if they never do", () => {
  assert.equal(classifyPitcher([relief(9), relief(3), relief(6), relief(4)]).role, 'starter')
  assert.equal(classifyPitcher([relief(6), relief(5), relief(6), relief(4)]).role, 'opener')
  assert.equal(classifyPitcher([relief(3), relief(4), relief(3), relief(5)]).role, 'opener')
})

test('on a team that uses openers the rule is looser', () => {
  const swingman = [relief(1), start(9), relief(3), start(3), relief(3), start(10)]
  assert.equal(classifyPitcher(swingman).role, 'starter')
  assert.equal(classifyPitcher(swingman, { openerGames: 5 }).role, 'opener')
  // Two appearances are enough there, first start or not.
  assert.equal(classifyPitcher([relief(9), relief(3)], { openerGames: 4 }).role, 'opener')
  assert.equal(classifyPitcher([relief(9), relief(3)], { openerGames: 0 }).role, 'starter')
})

test('a reliever who just went 4 IP in a start is a starter (stretched out)', () => {
  // Relief 3, relief 3, then a 12-out start: averages 6 outs and 2 of 3 in
  // relief, but the latest start already went long.
  assert.equal(classifyPitcher([start(12, 60), relief(3), relief(3)]).role, 'starter')
})

test('one or two short relief outings are not enough to call a first start an opener', () => {
  assert.equal(classifyPitcher([relief(6), relief(5), start(9, 45)]).role, 'starter')
})

test('no history: starter', () => {
  const r = classifyPitcher([])
  assert.equal(r.role, 'starter')
  assert.equal(r.avgOuts, null)
})

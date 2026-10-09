import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPitcher, type Appearance } from '../../server/openers/detect.js'

const start = (outs: number): Appearance => ({ isStart: true, outs })
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

test('no history: starter', () => {
  const r = classifyPitcher([])
  assert.equal(r.role, 'starter')
  assert.equal(r.avgOuts, null)
})

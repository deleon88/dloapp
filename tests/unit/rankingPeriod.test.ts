import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodRange } from '../../server/rankingPeriod.js'

test('the week runs Monday to today', () => {
  assert.deepEqual(periodRange('week', '2026-10-04'), { from: '2026-09-28', to: '2026-10-04' })   // Sunday
  assert.deepEqual(periodRange('week', '2026-10-05'), { from: '2026-10-05', to: '2026-10-05' })   // Monday
  assert.deepEqual(periodRange('week', '2026-10-01'), { from: '2026-09-28', to: '2026-10-01' })   // crosses the month
  assert.deepEqual(periodRange('week', '2027-01-01'), { from: '2026-12-28', to: '2027-01-01' })   // crosses the year
})

test('today, month and season ranges', () => {
  assert.deepEqual(periodRange('today', '2026-10-05'), { from: '2026-10-05', to: '2026-10-05' })
  assert.deepEqual(periodRange('month', '2026-10-05'), { from: '2026-10-01', to: '2026-10-05' })
  assert.deepEqual(periodRange('season', '2026-10-05'), { from: '2026-01-01', to: '2026-12-31' })
})

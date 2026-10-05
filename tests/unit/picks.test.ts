import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickResult, summarize } from '../../server/picks.js'

test('pick result by game status', () => {
  assert.equal(pickResult('Final', 'Final', 147, 147), 'won')
  assert.equal(pickResult('Final', 'Final', 139, 147), 'lost')
  assert.equal(pickResult('In Progress', 'Live', null, 147), 'pending')
  assert.equal(pickResult('Postponed', 'Final', null, 147), 'void')
  assert.equal(pickResult('Cancelled', 'Final', null, 147), 'void')
  assert.equal(pickResult('Final', 'Final', null, 147), 'void')
})

test('summary: record, hit rate and streaks (newest first)', () => {
  const s = summarize(['pending', 'won', 'void', 'won', 'won', 'lost', 'won', 'won', 'won', 'won', 'lost'])
  assert.equal(s.won, 7)
  assert.equal(s.lost, 2)
  assert.equal(s.pending, 1)
  assert.equal(s.pct, 78)
  assert.deepEqual(s.streak, { kind: 'won', n: 3 })   // pending and void don't break it
  assert.equal(s.bestStreak, 4)
})

test('summary: losing streak, and no picks', () => {
  assert.deepEqual(summarize(['lost', 'lost', 'won']).streak, { kind: 'lost', n: 2 })
  const empty = summarize(['pending'])
  assert.equal(empty.pct, null)
  assert.equal(empty.streak, null)
  assert.equal(empty.bestStreak, 0)
})

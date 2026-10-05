import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlays } from '../../server/mlb/pbp.js'

const A = 100, B = 200   // A starts; B relieves him mid-PA
const pitch = (balls: number, strikes: number) => ({ isPitch: true, count: { balls, strikes } })
const change = { details: { eventType: 'pitching_substitution' }, isSubstitution: true, position: { abbreviation: 'P' } }

function play(atBatIndex: number, event: string, pitcher: number, hand: string, playEvents: object[] = []) {
  return {
    result: { event, eventType: event.toLowerCase().replace(/ /g, '_'), rbi: 0 },
    about: { atBatIndex, inning: 7, halfInning: 'top' },
    count: { outs: event === 'Groundout' ? 1 : 0 },
    matchup: { batter: { id: 1 + atBatIndex }, pitcher: { id: pitcher }, batSide: { code: 'R' }, pitchHand: { code: hand } },
    runners: [],
    playEvents,
  }
}

// Rule 9.16(h): A leaves with the count at 3-0, B finishes the walk → A's walk.
test('a walk after a mid-PA change in a hitter\'s count is charged to the preceding pitcher', () => {
  const rows = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Walk', B, 'R', [pitch(1, 0), pitch(2, 0), pitch(3, 0), change, pitch(4, 0)]),
  ])
  assert.equal(rows[1].pitcher_id, A)
  assert.equal(rows[1].pitch_hand, 'L')
})

test('a walk after a change in a pitcher\'s count stays with the reliever', () => {
  const rows = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Walk', B, 'R', [pitch(1, 0), pitch(1, 1), pitch(1, 2), change, pitch(2, 2), pitch(3, 2), pitch(4, 2)]),
  ])
  assert.equal(rows[1].pitcher_id, B)
})

test('anything other than a walk goes to the reliever, even in a hitter\'s count', () => {
  const rows = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Single', B, 'R', [pitch(1, 0), pitch(2, 0), change, pitch(2, 0)]),
  ])
  assert.equal(rows[1].pitcher_id, B)
})

// Two changes in one PA (game 825022): A leaves at 0-0, B pitches to 2-0, C
// enters and finishes the walk → the walk is B's, who was replaced in a
// hitter's count. B has no matchup of his own, so his hand comes later
// (fetchGamePlays looks it up).
test('with two changes in one PA, the last change decides and the replaced pitcher is charged', () => {
  const C = 300
  const rows = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Walk', C, 'R', [
      { ...change, player: { id: B } }, pitch(1, 0), pitch(2, 0),
      { ...change, player: { id: C } }, pitch(2, 1), pitch(3, 1), pitch(4, 1),
    ]),
  ])
  assert.equal(rows[1].pitcher_id, B)
  assert.equal(rows[1].pitch_hand, null)
})

test('an intentional walk issued right after the change (0-0) is the reliever\'s', () => {
  const rows = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Intent Walk', B, 'R', [change]),
  ])
  assert.equal(rows[1].pitcher_id, B)
  // The next PA is B's either way.
  const more = parsePlays(1, '2026-09-30', [
    play(0, 'Groundout', A, 'L', [pitch(0, 0)]),
    play(1, 'Walk', B, 'R', [pitch(3, 1), change, pitch(4, 1)]),
    play(2, 'Groundout', B, 'R', [pitch(0, 0)]),
  ])
  assert.deepEqual(more.map(r => r.pitcher_id), [A, A, B])
})

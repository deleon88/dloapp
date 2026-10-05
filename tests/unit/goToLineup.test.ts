import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGoToLineup, type Hand, type PastLineup, type RosterInfo } from '../../server/lineups/predict.js'
import { parseLineups } from '../../server/mlb/appearances.js'

test('boxscore lineups: starters by their own battingOrder, not the final occupant of the spot', () => {
  const rows = parseLineups(1, {
    away: {
      team: { id: 114 },
      players: {
        ID10: { battingOrder: '500', allPositions: [{ abbreviation: '2B' }], stats: { fielding: { innings: '6.0' } } },
        ID11: { battingOrder: '501', allPositions: [{ abbreviation: 'PH' }] },   // pinch hitter for the 5th spot
        ID12: { battingOrder: '100', allPositions: [{ abbreviation: 'P' }, { abbreviation: 'DH' }] },  // two-way
        ID13: { allPositions: [{ abbreviation: 'P' }] },                          // reliever, didn't bat
      },
    },
  })
  assert.deepEqual(rows.map(r => [r.spot, r.player_id, r.position, r.innings]), [[1, 12, 'DH', 9], [5, 10, '2B', 6]])
})

const POS = ['CF', 'SS', '1B', 'DH', '3B', 'RF', 'LF', 'C', '2B']

/** A lineup where player ids[i] bats (i+1)th at POS[i] unless overridden. */
function game(gamePk: number, vsHand: Hand | null, ids: number[], pos = POS): PastLineup {
  return { gamePk, vsHand, slots: ids.map((playerId, i) => ({ playerId, position: pos[i], innings: 9 })) }
}

const REGULARS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function roster(over: Partial<RosterInfo> = {}): RosterInfo {
  return { active: null, unavailable: new Set(), depthByPosition: new Map(), ...over }
}

const ids = (r: ReturnType<typeof buildGoToLineup>) => r.lineup?.map(s => s.id)

test('uses only the last 5 games against that hand', () => {
  // vs LHP, player 20 started at RF in the 5 most recent; 6 in the older ones.
  const withPlatoon = [1, 2, 3, 4, 5, 20, 7, 8, 9]
  const history = [
    game(10, 'L', withPlatoon), game(9, 'R', REGULARS), game(8, 'L', withPlatoon), game(7, 'L', withPlatoon),
    game(6, 'L', withPlatoon), game(5, 'L', withPlatoon),
    game(4, 'L', REGULARS), game(3, 'L', REGULARS), game(2, 'L', REGULARS), game(1, 'L', REGULARS),
  ]
  const vsL = buildGoToLineup(history, 'L', roster())
  assert.deepEqual(vsL.games, [10, 8, 7, 6, 5])
  assert.equal(vsL.fallback, false)
  assert.equal(vsL.lineup?.[5].id, 20)
  assert.equal(vsL.lineup?.[5].confidence, 100)

  // vs RHP there's a single game: falls back to the last 5 overall.
  const vsR = buildGoToLineup(history, 'R', roster())
  assert.equal(vsR.fallback, true)
  assert.deepEqual(vsR.games, [10, 9, 8, 7, 6])
})

test('platoon splits come out of each hand separately', () => {
  const vsLeft = [1, 2, 3, 4, 5, 20, 7, 8, 9]
  const history = [
    game(6, 'L', vsLeft), game(5, 'R', REGULARS), game(4, 'L', vsLeft),
    game(3, 'R', REGULARS), game(2, 'L', vsLeft), game(1, 'R', REGULARS),
  ]
  assert.deepEqual(ids(buildGoToLineup(history, 'L', roster())), vsLeft)
  assert.deepEqual(ids(buildGoToLineup(history, 'R', roster())), REGULARS)
})

test('injured or inactive players are replaced', () => {
  const history = [game(3, 'R', REGULARS), game(2, 'R', REGULARS), game(1, 'R', [1, 2, 3, 4, 5, 6, 7, 8, 30])]
  // 9 (2B) is on the IL: whoever else batted 9th (30) takes it.
  const r = buildGoToLineup(history, 'R', roster({ unavailable: new Set([9]) }))
  assert.equal(r.lineup?.[8].id, 30)
  assert.equal(r.lineup?.[8].pos, '2B')
  assert.ok(!ids(r)?.includes(9))

  // Not on the active roster (optioned/traded) counts the same.
  const active = new Set([1, 2, 3, 4, 5, 6, 7, 8, 30])
  assert.ok(!ids(buildGoToLineup(history, 'R', roster({ active })))?.includes(9))
})

test('with no history at that spot the depth chart fills the position', () => {
  const history = [game(2, 'R', REGULARS), game(1, 'R', REGULARS)]
  const depthByPosition = new Map([['C', [{ id: 8, fullName: 'Starter C', jerseyNumber: '' }, { id: 40, fullName: 'Backup C', jerseyNumber: '' }]]])
  const r = buildGoToLineup(history, 'R', roster({ unavailable: new Set([8]), depthByPosition }))
  const c = r.lineup?.find(s => s.pos === 'C')
  assert.equal(c?.id, 40)
  assert.equal(c?.status, 'returning')
  assert.equal(r.lineup?.length, 9)
})

test('positions never repeat', () => {
  // Two players listed at SS from the same spot in different games.
  const history = [
    game(3, 'R', REGULARS),
    game(2, 'R', [1, 50, 3, 4, 5, 6, 7, 8, 9]),
    game(1, 'R', [1, 50, 3, 4, 5, 6, 7, 8, 2], [...POS.slice(0, 8), 'SS']),
  ]
  const r = buildGoToLineup(history, 'R', roster())
  const positions = r.lineup!.map(s => s.pos)
  assert.equal(new Set(positions).size, positions.length)
})

test('previous go-to breaks frequency ties', () => {
  const history = [
    game(4, 'R', REGULARS), game(3, 'R', [1, 2, 3, 4, 5, 6, 7, 8, 60]),
    game(2, 'R', REGULARS), game(1, 'R', [1, 2, 3, 4, 5, 6, 7, 8, 60]),
  ]
  assert.equal(buildGoToLineup(history, 'R', roster(), [60]).lineup?.[8].id, 60)
  assert.equal(buildGoToLineup(history, 'R', roster(), [9]).lineup?.[8].id, 9)
})

test('no games: no lineup', () => {
  const r = buildGoToLineup([], 'L', roster())
  assert.equal(r.lineup, null)
  assert.deepEqual(r.games, [])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etDate, shiftDate } from '../../src/utils/etDate.js'
import { isSafeReturnPath } from '../../src/utils/safePath.js'

test('shiftDate crosses months, years and leap days without time-zone drift', () => {
  assert.equal(shiftDate('2026-10-04', -1), '2026-10-03')
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29')
  assert.equal(shiftDate('2026-09-27', 18), '2026-10-15')
})

test('etDate is a YYYY-MM-DD calendar date, one day apart per day', () => {
  assert.match(etDate(), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(shiftDate(etDate(), -1), etDate(1))
})

test('isSafeReturnPath only accepts same-site paths', () => {
  for (const ok of ['/', '/schedule', '/game/849825?x=1', '/profile#top'])
    assert.equal(isSafeReturnPath(ok), true, ok)
  for (const bad of [null, undefined, '', 'schedule', 'https://evil.com', '//evil.com', '/\\evil.com',
    '/schedule\\..\\x', '/\tevil', 'javascript:alert(1)'])
    assert.equal(isSafeReturnPath(bad), false, String(bad))
})

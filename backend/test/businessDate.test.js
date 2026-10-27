import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDateRange, dateInTimeZone } from '../src/businessDate.js';

test('business date boundaries follow Asia/Manila local midnight', () => {
  const range = businessDateRange('2026-01-01', 'Asia/Manila');
  assert.equal(range.start.toISOString(), '2025-12-31T16:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-01-01T16:00:00.000Z');
  assert.equal(dateInTimeZone(new Date('2025-12-31T16:00:00.000Z'), 'Asia/Manila'), '2026-01-01');
});

test('business date range handles a daylight-saving transition', () => {
  const range = businessDateRange('2026-03-08', 'America/New_York');
  assert.equal(range.start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-03-09T04:00:00.000Z');
});

test('business date range rejects invalid dates and time zones', () => {
  assert.throws(() => businessDateRange('2026-02-30', 'Asia/Manila'), RangeError);
  assert.throws(() => businessDateRange('2026-01-01', 'Not/A_Zone'), RangeError);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { partsUsedOnDate } from './technicianMetrics.js';

test('parts used today sums unique work-order item quantities for the selected local date', () => {
  const jobs = [
    { items: [
      { id: '1', addedAt: '2026-10-27T09:00:00', quantityUsed: 3 },
      { id: '2', addedAt: '2026-10-27T10:00:00', quantityUsed: 2 },
      { id: '3', addedAt: '2026-10-26T23:59:00', quantityUsed: 8 }
    ] },
    { items: [
      { id: '2', addedAt: '2026-10-27T10:00:00', quantityUsed: 2 },
      { id: '4', addedAt: '2026-10-27T11:00:00', quantityUsed: 1 }
    ] }
  ];

  assert.equal(partsUsedOnDate(jobs, '2026-10-27'), 6);
});

test('parts used today ignores missing, invalid, and non-positive item data', () => {
  const jobs = [{ items: [
    { id: '1', addedAt: '2026-10-27T09:00:00', quantityUsed: 2 },
    { id: '2', addedAt: null, quantityUsed: 10 },
    { id: '3', addedAt: 'invalid-date', quantityUsed: 10 },
    { id: '4', addedAt: '2026-10-27T10:00:00', quantityUsed: 0 },
    { id: '5', addedAt: '2026-10-27T11:00:00', quantityUsed: 'invalid' }
  ] }];

  assert.equal(partsUsedOnDate(jobs, '2026-10-27'), 2);
});

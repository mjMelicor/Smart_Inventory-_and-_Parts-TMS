import assert from 'node:assert/strict';
import test from 'node:test';
import { dailySalesTotals, moneyCents } from '../src/money.js';

test('money amounts convert to integer cents', () => {
  assert.equal(moneyCents(0.1), 10);
  assert.equal(moneyCents('128.45'), 12845);
});

test('daily sales totals sum cents without floating-point drift', () => {
  const totals = dailySalesTotals([
    { total: 0.1, partsTotal: 0.1, laborFee: 0 },
    { total: 0.2, partsTotal: 0.2, laborFee: 0 }
  ]);
  assert.deepEqual(totals, { repairBillings: 0.3, partsRevenue: 0.3, laborRevenue: 0 });
});

test('daily sales totals are zero when there are no completed work orders', () => {
  assert.deepEqual(dailySalesTotals([]), { repairBillings: 0, partsRevenue: 0, laborRevenue: 0 });
});

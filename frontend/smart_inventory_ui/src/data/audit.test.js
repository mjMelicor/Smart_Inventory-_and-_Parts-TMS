import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAuditEntry } from './audit.js';

test('dispatch audit entries show part, signed stock change, and transfer direction', () => {
  const entry = mapAuditEntry({
    tableName: 'inventory',
    operation: 'UPDATE',
    branch: 'North Branch',
    user: 'Branch Manager',
    timestamp: '2026-10-28T00:00:00.000Z',
    details: {
      old: { part_id: '17', branch_id: '1', quantity_on_hand: 20, quantity_reserved: 5 },
      new: { part_id: '17', branch_id: '1', quantity_on_hand: 14, quantity_reserved: 0 },
      details: { action: 'STOCK_DISPATCHED', transferId: '42' }
    }
  }, {
    parts: [{ id: '17', name: 'Brake Pad' }],
    branches: [
      { id: '1', name: 'North Branch' },
      { id: '2', name: 'South Branch' }
    ],
    transfers: [{ id: '42', destinationBranchId: '2' }]
  });

  assert.equal(entry.action, 'STOCK_DISPATCHED');
  assert.equal(entry.part, 'Brake Pad');
  assert.equal(entry.qty, -6);
  assert.equal(entry.from, 'North Branch');
  assert.equal(entry.to, 'South Branch');
});

test('non-dispatch audit entries keep their existing detail mapping', () => {
  const entry = mapAuditEntry({
    tableName: 'inventory',
    operation: 'UPDATE',
    branch: 'North Branch',
    details: { details: { action: 'STOCK_ADJUSTED', partId: '17', quantityChange: 3 } }
  }, {
    parts: [{ id: '17', name: 'Brake Pad' }],
    branches: [],
    transfers: []
  });

  assert.equal(entry.action, 'STOCK_ADJUSTED');
  assert.equal(entry.part, 'Brake Pad');
  assert.equal(entry.qty, 3);
  assert.equal(entry.from, 'North Branch');
  assert.equal(entry.to, '');
});

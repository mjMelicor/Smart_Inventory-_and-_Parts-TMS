import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../src/db.js';
import { router } from '../src/routes.js';

function responseDouble() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function partUsageRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/work-orders/:id/items' && layer.route.methods.post);
  assert.ok(registered, 'work-order part-usage route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ quantity, userId = 5n, branchId = 3n, workOrderId = 42n, partId = 1n }) => {
    const req = {
      user: { id: userId, role: 'technician', branchId, branchIsActive: true },
      params: { id: String(workOrderId) },
      body: { quantity, partId: String(partId) },
      get: header => header === 'Idempotency-Key' ? '1dce7ccb-4e6f-4690-888b-65e5627f38de' : undefined
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

test('replaying the same work-order parts request does not deduct or bill twice', async () => {
  const previousTransaction = prisma.$transaction;
  const stock = { quantityOnHand: 8, quantityReserved: 3 };
  const workOrder = {
    id: 42n,
    branchId: 3n,
    assignedTechnicianId: 5n,
    status: 'in_progress',
    totalAmount: 100
  };
  const items = [];
  const auditEvents = [];
  let nextItemId = 70n;
  let inventoryDeductions = 0;
  let itemCreations = 0;
  const route = partUsageRoute();

  prisma.$transaction = async callback => {
    const tx = {
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join(' ');
        if (sql.includes('SELECT table_name AS')) {
          const key = values.find(value => typeof value === 'string' && value.includes('-'));
          const event = auditEvents.find(row => row.performedByUserId === values[0] && row.oldData.idempotencyKey === key);
          return event ? [{
            tableName: event.tableName,
            operation: event.operation,
            recordId: event.recordId,
            performedByUserId: event.performedByUserId,
            oldData: event.oldData
          }] : [];
        }
        if (sql.includes('SELECT quantity_on_hand, quantity_reserved')) {
          return [{ quantity_on_hand: stock.quantityOnHand, quantity_reserved: stock.quantityReserved }];
        }
        return [];
      },
      workOrder: {
        findUnique: async () => ({ ...workOrder }),
        update: async ({ data }) => {
          workOrder.status = data.status;
          workOrder.totalAmount += data.totalAmount.increment;
          return { ...workOrder };
        }
      },
      workOrderItem: {
        findUnique: async ({ where }) => items.find(item => item.id === where.id) || null,
        create: async ({ data }) => {
          const item = { ...data, id: nextItemId++ };
          items.push(item);
          itemCreations += 1;
          return item;
        }
      },
      part: { findUnique: async () => ({ retailPrice: 4.5 }) },
      inventory: {
        update: async ({ data }) => {
          stock.quantityOnHand -= data.quantityOnHand.decrement;
          inventoryDeductions += 1;
          return stock;
        }
      },
      auditLog: {
        create: async ({ data }) => {
          auditEvents.push(data);
          return data;
        }
      }
    };
    return callback(tx);
  };

  try {
    const first = await route({ quantity: 2 });
    const retry = await route({ quantity: 2 });
    assert.equal(first.error, undefined);
    assert.equal(retry.error, undefined);
    assert.equal(first.res.statusCode, 201);
    assert.equal(retry.res.statusCode, 201);
    assert.equal(first.res.body.id, retry.res.body.id);
    assert.equal(stock.quantityOnHand, 6);
    assert.equal(inventoryDeductions, 1);
    assert.equal(itemCreations, 1);
    assert.equal(workOrder.totalAmount, 109);
    assert.equal(auditEvents.length, 1);

    const mismatchedRetry = await route({ quantity: 3 });
    assert.equal(mismatchedRetry.error?.status, 409);
    assert.equal(mismatchedRetry.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(stock.quantityOnHand, 6);
    assert.equal(itemCreations, 1);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

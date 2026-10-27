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

function receiveRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers/:id/receive' && layer.route.methods.post);
  assert.ok(registered, 'transfer receipt route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ userId = 5n, branchId = 3n, key, quantity }) => {
    const req = {
      user: { id: userId, role: 'branch_manager', branchId },
      params: { id: '42' },
      body: { quantity },
      get: header => header === 'Idempotency-Key' ? key : undefined
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

function transferRequestRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers' && layer.route.methods.post);
  assert.ok(registered, 'transfer request route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ key, quantity = 4, notes = 'Needed for repair' }) => {
    const req = {
      user: { id: 9n, role: 'technician', branchId: 3n },
      body: { partId: '1', sourceBranchId: '1', quantity, notes },
      get: header => header === 'Idempotency-Key' ? key : undefined
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

function dispatchRoute() {
  const registered = router.stack.find(layer => layer.route?.path === '/transfers/:id/dispatch' && layer.route.methods.post);
  assert.ok(registered, 'transfer dispatch route is registered');
  const [authorize, handler] = registered.route.stack.map(layer => layer.handle);
  return async ({ branchId = 1n } = {}) => {
    const req = {
      user: { id: 5n, role: 'branch_manager', branchId },
      params: { id: '42' }
    };
    const res = responseDouble();
    let error;
    authorize(req, res, caught => { error = caught; });
    if (!error && res.statusCode === null) await handler(req, res, caught => { error = caught; });
    return { res, error };
  };
}

test('dispatch route deducts reserved stock once and enforces the source branch', async () => {
  const previousTransaction = prisma.$transaction;
  const inventory = { quantityOnHand: 45, quantityReserved: 5 };
  const transfer = {
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'approved',
    items: [{ id: 6n, partId: 1n, quantityRequested: 5, quantityApproved: 5, quantityReceived: 0 }]
  };
  let inventoryUpdates = 0;
  const route = dispatchRoute();
  prisma.$transaction = async callback => callback({
    $queryRaw: async () => [],
    $executeRaw: async () => {
      if (inventory.quantityOnHand < 5 || inventory.quantityReserved < 5) return 0;
      inventory.quantityOnHand -= 5;
      inventory.quantityReserved -= 5;
      inventoryUpdates += 1;
      return 1;
    },
    transferRequest: {
      findUnique: async () => ({ ...transfer, items: transfer.items.map(item => ({ ...item })) }),
      update: async ({ data }) => {
        transfer.status = data.status;
        return { ...transfer, items: transfer.items.map(item => ({ ...item })) };
      }
    }
  });

  try {
    const dispatched = await route();
    assert.equal(dispatched.error, undefined);
    assert.equal(dispatched.res.body.status, 'dispatched');
    assert.deepEqual(inventory, { quantityOnHand: 40, quantityReserved: 0 });
    assert.equal(inventoryUpdates, 1);

    const duplicate = await route();
    assert.equal(duplicate.error?.status, 409);
    assert.equal(inventoryUpdates, 1);

    const wrongBranch = await route({ branchId: 2n });
    assert.equal(wrongBranch.error?.status, 403);
    assert.equal(inventoryUpdates, 1);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

test('concurrent identical transfer requests reserve stock once and changed details conflict', async () => {
  const previousTransaction = prisma.$transaction;
  const availableStock = { onHand: 20, reserved: 2 };
  const auditEvents = [];
  const transfers = new Map();
  let transferId = 101n;
  let reservationUpdates = 0;
  let lockTail = Promise.resolve();
  const key = '2e6bfe06-f33d-4924-bef6-9e6f7913ce67';
  const route = transferRequestRoute();

  prisma.$transaction = async callback => {
    let releaseLock;
    try {
      return await callback({
        $queryRaw: async (strings, ...values) => {
          const sql = strings.join(' ');
          if (sql.includes('pg_advisory_xact_lock')) {
            const previous = lockTail;
            let unlock;
            lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
            releaseLock = unlock;
            return [];
          }
          if (!sql.includes('SELECT table_name AS')) return [];
          const [userId, idempotencyKey] = values;
          const event = auditEvents.find(row => row.performedByUserId === userId
            && row.oldData.idempotencyKey === idempotencyKey);
          return event ? [{
            tableName: event.tableName,
            operation: event.operation,
            recordId: event.recordId,
            performedByUserId: event.performedByUserId,
            oldData: event.oldData
          }] : [];
        },
        branch: { findUnique: async ({ where }) => ({ id: where.id, isActive: true }) },
        part: { findUnique: async () => ({ id: 1n }) },
        $executeRaw: async (_strings, ...values) => {
          const quantity = values.at(-1);
          if (availableStock.onHand - availableStock.reserved < quantity) return 0;
          availableStock.reserved += quantity;
          reservationUpdates += 1;
          return 1;
        },
        transferRequest: {
          create: async ({ data }) => {
            const created = {
              id: transferId++,
              code: data.code,
              sourceBranchId: data.sourceBranchId,
              destinationBranchId: data.destinationBranchId,
              requestedByUserId: data.requestedByUserId,
              status: data.status,
              requestNotes: data.requestNotes,
              items: [{ id: transferId + 100n, ...data.items.create }]
            };
            transfers.set(created.id, created);
            return created;
          },
          findUnique: async ({ where }) => transfers.get(where.id) || null
        },
        auditLog: {
          create: async ({ data }) => {
            auditEvents.push(data);
            return data;
          }
        }
      });
    } finally {
      releaseLock?.();
    }
  };

  try {
    const [first, retry] = await Promise.all([route({ key }), route({ key })]);
    assert.equal(first.error, undefined);
    assert.equal(retry.error, undefined);
    assert.equal(first.res.statusCode, 201);
    assert.equal(retry.res.statusCode, 201);
    assert.equal(first.res.body.id, retry.res.body.id);
    assert.deepEqual(availableStock, { onHand: 20, reserved: 6 });
    assert.equal(reservationUpdates, 1);
    assert.equal(transfers.size, 1);
    assert.equal(auditEvents.length, 1);

    const changedRequest = await route({ key, quantity: 3 });
    assert.equal(changedRequest.error?.status, 409);
    assert.equal(changedRequest.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(availableStock.reserved, 6);
    assert.equal(reservationUpdates, 1);
    assert.equal(transfers.size, 1);
  } finally {
    prisma.$transaction = previousTransaction;
  }
});

test('concurrent identical partial receipt retries change inventory once', async () => {
  const previousTransaction = prisma.$transaction;
  const previousEventLookup = prisma.transferReceiptEvent.findUnique;
  const previousTransferLookup = prisma.transferRequest.findUnique;
  const receiptItem = {
    id: 6n,
    partId: 1n,
    quantityRequested: 5,
    quantityApproved: 5,
    quantityReceived: 0
  };
  const transfer = {
    id: 42n,
    sourceBranchId: 1n,
    destinationBranchId: 3n,
    status: 'dispatched',
    items: [receiptItem]
  };
  const events = new Map();
  const inventory = { quantityOnHand: 25 };
  const key = '86d7c9a5-bc58-48d8-9c44-711c8b92046d';
  const route = receiveRoute();
  let releaseInitialReads;
  const initialReadsComplete = new Promise(resolve => { releaseInitialReads = resolve; });
  let initialReadsRemaining = 2;
  let pendingEvent = null;
  let createAttempts = 0;
  let uniqueConflicts = 0;

  const findEvent = async ({ where, include }) => {
    const event = events.get(where.idempotencyKey);
    if (!event) return null;
    return include ? { ...event, transferItem: { transferId: transfer.id } } : event;
  };
  prisma.transferReceiptEvent.findUnique = findEvent;
  prisma.transferRequest.findUnique = async () => ({ ...transfer, items: [{ ...receiptItem }] });
  prisma.$transaction = async callback => {
    let stagedEvent = null;
    const transactionFindEvent = async args => {
      const result = await findEvent(args);
      if (initialReadsRemaining > 0) {
        initialReadsRemaining -= 1;
        if (initialReadsRemaining === 0) releaseInitialReads();
        await initialReadsComplete;
      }
      return result;
    };
    const tx = {
      $queryRaw: async () => [],
      transferRequest: {
        findUnique: async () => ({ ...transfer, items: [{ ...receiptItem }] }),
        update: async ({ data }) => {
          transfer.status = data.status;
          return { ...transfer, items: [{ ...receiptItem }] };
        }
      },
      transferReceiptEvent: {
        findUnique: transactionFindEvent,
        create: async ({ data }) => {
          createAttempts += 1;
          if (events.has(data.idempotencyKey)) throw Object.assign(new Error('unique key'), { code: 'P2002' });
          if (pendingEvent) {
            await pendingEvent.committed;
            uniqueConflicts += 1;
            throw Object.assign(new Error('unique key'), { code: 'P2002' });
          }
          let commit;
          const committed = new Promise(resolve => { commit = resolve; });
          pendingEvent = { key: data.idempotencyKey, data, committed, commit };
          stagedEvent = pendingEvent;
          return data;
        }
      },
      inventory: {
        upsert: async ({ update }) => {
          inventory.quantityOnHand += update.quantityOnHand.increment;
          return inventory;
        }
      },
      transferItem: {
        update: async ({ data }) => {
          receiptItem.quantityReceived = data.quantityReceived;
          return receiptItem;
        }
      }
    };
    try {
      const result = await callback(tx);
      if (stagedEvent) {
        events.set(stagedEvent.key, stagedEvent.data);
        pendingEvent = null;
        stagedEvent.commit();
      }
      return result;
    } catch (error) {
      if (stagedEvent) {
        pendingEvent = null;
        stagedEvent.commit();
      }
      throw error;
    }
  };

  try {
    const [first, retry] = await Promise.all([
      route({ key, quantity: 2 }),
      route({ key, quantity: 2 })
    ]);

    assert.equal(first.error, undefined);
    assert.equal(retry.error, undefined);
    assert.equal(first.res.body.items[0].quantityReceived, 2);
    assert.equal(retry.res.body.items[0].quantityReceived, 2);
    assert.equal(inventory.quantityOnHand, 27);
    assert.equal(events.size, 1);
    assert.equal(createAttempts, 2);
    assert.equal(uniqueConflicts, 1);

    const mismatchedQuantity = await route({ key, quantity: 1 });
    assert.equal(mismatchedQuantity.error?.status, 409);
    assert.equal(mismatchedQuantity.error?.code, 'IDEMPOTENCY_KEY_REUSED');

    const differentUser = await route({ userId: 7n, key, quantity: 2 });
    assert.equal(differentUser.error?.status, 409);
    assert.equal(differentUser.error?.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(inventory.quantityOnHand, 27);

    const intentionalSecondReceipt = await route({
      key: 'da3c98ab-06dc-4db4-9d43-cb5bc24816ca',
      quantity: 1
    });
    assert.equal(intentionalSecondReceipt.error, undefined);
    assert.equal(intentionalSecondReceipt.res.body.items[0].quantityReceived, 3);
    assert.equal(inventory.quantityOnHand, 28);
    assert.equal(events.size, 2);
  } finally {
    prisma.$transaction = previousTransaction;
    prisma.transferReceiptEvent.findUnique = previousEventLookup;
    prisma.transferRequest.findUnique = previousTransferLookup;
  }
});
